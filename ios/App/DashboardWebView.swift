import SwiftUI
import WebKit

/// Hosts the bundled dashboard pages (Web/) in a WKWebView.
struct DashboardWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        // The pages run from file://; let them call Supabase / Open Food Facts without CORS blocking them.
        cfg.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        cfg.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        let noLinkCallout = "(function(){var s=document.createElement('style');"
            + "s.textContent='a[href]{-webkit-touch-callout:none}';"
            + "(document.head||document.documentElement).appendChild(s);})();"
        cfg.userContentController.addUserScript(
            WKUserScript(source: noLinkCallout, injectionTime: .atDocumentEnd, forMainFrameOnly: false))

        let web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = context.coordinator
        web.navigationDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.contentInsetAdjustmentBehavior = .never   // pages handle env(safe-area-inset-*) themselves
        web.allowsBackForwardNavigationGestures = true
        // Long-pressing a tab, the water pill or Finance must not open a preview of a file:// page.
        // allowsLinkPreview only drops the preview, so links also get -webkit-touch-callout: none
        // (no Open / Copy / Share menu), in every frame.
        web.allowsLinkPreview = false
        web.isInspectable = true

        context.coordinator.loadHome(web)
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    /// Runs its body at most once. WebKit throws if a JS panel's completion
    /// handler is never called, and it must not be called twice either.
    final class Once {
        private var fired = false
        func run(_ body: () -> Void) {
            guard !fired else { return }
            fired = true
            body()
        }
    }

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate {
        private var downloadDestinations: [ObjectIdentifier: URL] = [:]

        private var webDirectory: URL? { Bundle.main.url(forResource: "Web", withExtension: nil) }

        func loadHome(_ web: WKWebView) {
            guard let dir = webDirectory else { return }
            web.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
        }

        // Keep the dashboard inside the app; send real web links to Safari.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.shouldPerformDownload {
                // <a download> (Export JSON on Fitness and Water) becomes a WKDownload, then the share sheet.
                decisionHandler(.download)
            } else if let url = action.request.url, ["http", "https"].contains(url.scheme ?? ""), action.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
        }

        // target="_blank" / window.open: web links go to Safari, our own pages load here.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url {
                if ["http", "https"].contains(url.scheme ?? "") {
                    UIApplication.shared.open(url)
                } else if url.isFileURL, let dir = webDirectory {
                    webView.loadFileURL(url, allowingReadAccessTo: dir)
                }
            }
            return nil
        }

        // iOS can kill the web content process (memory pressure, e.g. after the
        // camera). Without a reload the app is stuck on a blank screen.
        // Bundled pages load again with loadFileURL, so the new process gets read
        // access to Web/ (the same page, including a #water anchor).
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            if let url = webView.url, url.isFileURL, let dir = webDirectory {
                webView.loadFileURL(url, allowingReadAccessTo: dir)
            } else if webView.url != nil {
                webView.reload()
            } else {
                loadHome(webView)
            }
        }

        // MARK: Downloads (Export JSON)

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
            download.delegate = self
        }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                      suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            // A fresh folder per file keeps the page's file name and never collides.
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent("Exports", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            } catch {
                completionHandler(nil)   // nil cancels the download
                return
            }
            let name = suggestedFilename.isEmpty ? "export.json" : suggestedFilename
            let url = dir.appendingPathComponent(name)
            downloadDestinations[ObjectIdentifier(download)] = url
            completionHandler(url)
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let url = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
            // Save to Files, AirDrop, Mail and so on.
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let popover = share.popoverPresentationController, let view = download.webView {
                popover.sourceView = view
                popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            }
            present(share)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        }

        // MARK: alert() / confirm() / prompt()

        // The pages use alert()/confirm()/prompt(); WKWebView shows nothing unless we do.
        // Presents on the topmost view controller once no transition is running (for
        // example the file picker still closing when Import's confirm() fires): it
        // checks again every 0.1 s for up to 2 s. Calls `fallback` when there is
        // nothing to present on, it never settles, or UIKit refuses, so the page's
        // call always returns.
        private func present(_ vc: UIViewController, orElse fallback: @escaping () -> Void = {}, attempt: Int = 0) {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let window = scenes.compactMap { $0.keyWindow }.first ?? scenes.flatMap { $0.windows }.first
            guard var top = window?.rootViewController else {
                fallback()
                return
            }
            while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
            let busy = top.presentedViewController != nil       // still dismissing something
                || top.isBeingPresented || top.transitionCoordinator != nil
                || top.viewIfLoaded?.window == nil
            if busy {
                guard attempt < 20 else {
                    fallback()
                    return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                    guard let self = self else {
                        fallback()
                        return
                    }
                    self.present(vc, orElse: fallback, attempt: attempt + 1)
                }
                return
            }
            top.present(vc, animated: true)
            if vc.presentingViewController == nil { fallback() }   // UIKit refused it
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping () -> Void) {
            let once = Once()
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in once.run { completionHandler() } })
            present(a, orElse: { once.run { completionHandler() } })
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping (Bool) -> Void) {
            let once = Once()
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in once.run { completionHandler(false) } })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in once.run { completionHandler(true) } })
            present(a, orElse: { once.run { completionHandler(false) } })
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let once = Once()
            let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            a.addTextField { $0.text = defaultText }
            a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in once.run { completionHandler(nil) } })
            a.addAction(UIAlertAction(title: "OK", style: .default) { [weak a] _ in
                let text = a?.textFields?.first?.text
                once.run { completionHandler(text) }
            })
            present(a, orElse: { once.run { completionHandler(nil) } })
        }

        // Camera for progress photos (the iOS permission prompt still appears once).
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(.grant)
        }
    }
}

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

        let web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = context.coordinator
        web.navigationDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.contentInsetAdjustmentBehavior = .never   // pages handle env(safe-area-inset-*) themselves
        web.allowsBackForwardNavigationGestures = true
        web.isInspectable = true

        if let dir = Bundle.main.url(forResource: "Web", withExtension: nil) {
            web.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
        }
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate {
        // Keep the dashboard inside the app; send real web links to Safari.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = action.request.url, ["http", "https"].contains(url.scheme ?? ""), action.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }

        // The pages use alert()/confirm()/prompt(); WKWebView shows nothing unless we do.
        private func present(_ alert: UIAlertController) {
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            var top = scene?.keyWindow?.rootViewController
            while let p = top?.presentedViewController { top = p }
            top?.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping () -> Void) {
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            present(a)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping (Bool) -> Void) {
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            present(a)
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            a.addTextField { $0.text = defaultText }
            a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
            present(a)
        }

        // Camera for progress photos (the iOS permission prompt still appears once).
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(.grant)
        }
    }
}

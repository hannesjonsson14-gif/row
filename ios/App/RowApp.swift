import SwiftUI

@main
struct RowApp: App {
    var body: some Scene {
        WindowGroup {
            DashboardWebView()
                .ignoresSafeArea()
                .background(Color.black)
                .preferredColorScheme(.dark)
        }
    }
}

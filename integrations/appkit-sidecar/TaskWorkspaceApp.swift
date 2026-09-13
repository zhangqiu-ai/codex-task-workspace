import AppKit
import CoreGraphics
import WebKit

private let officialBundleID = "com.openai.codex"

private struct CodexWindow {
    let frame: NSRect
}

private final class CodexLocator {
    func locate() -> CodexWindow? {
        let applications = NSRunningApplication.runningApplications(withBundleIdentifier: officialBundleID)
        let frontmost = NSWorkspace.shared.frontmostApplication
        let application = frontmost?.bundleIdentifier == officialBundleID
            ? frontmost
            : applications.first(where: { !$0.isTerminated })
        guard let pid = application?.processIdentifier,
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }

        // CGWindowList is front-to-back. The first normal, useful window for the
        // selected Codex process follows the window the user is actually using.
        let quartzFrame: CGRect? = windows.compactMap { window in
            guard (window[kCGWindowOwnerPID as String] as? pid_t) == pid,
                  (window[kCGWindowLayer as String] as? Int) == 0,
                  let bounds = window[kCGWindowBounds as String] as? [String: CGFloat],
                  let x = bounds["X"], let y = bounds["Y"],
                  let width = bounds["Width"], let height = bounds["Height"],
                  width > 520, height > 360 else { return nil }
            return CGRect(x: x, y: y, width: width, height: height)
        }.first

        guard let quartzFrame,
              let screen = NSScreen.screens.first(where: { screen in
                  guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID else { return false }
                  return CGDisplayBounds(number).contains(CGPoint(x: quartzFrame.midX, y: quartzFrame.midY))
              }),
              let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID else { return nil }

        let display = CGDisplayBounds(displayID)
        let appKitFrame = NSRect(
            x: screen.frame.minX + quartzFrame.minX - display.minX,
            y: screen.frame.maxY - (quartzFrame.minY - display.minY) - quartzFrame.height,
            width: quartzFrame.width,
            height: quartzFrame.height
        )
        return CodexWindow(frame: appKitFrame)
    }
}

private final class BoardService {
    private let runtimeRoot: URL
    private let dataRoot: URL
    private var process: Process?
    private var stdinPipe: Pipe?
    private var startupTimeout: DispatchWorkItem?
    private var completion: [(Result<URL, Error>) -> Void] = []
    private var output = ""

    init(resources: URL) {
        runtimeRoot = resources.appendingPathComponent("workspace-runtime", isDirectory: true)
        dataRoot = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Applications/Task Workspace/data", isDirectory: true)
    }

    func start(completion handler: @escaping (Result<URL, Error>) -> Void) {
        if let process, process.isRunning, let url = currentURL {
            handler(.success(url)); return
        }
        completion.append(handler)
        guard process == nil else { return }

        do {
            try FileManager.default.createDirectory(at: dataRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let node = runtimeRoot.appendingPathComponent("node")
            let server = runtimeRoot.appendingPathComponent("dist/http.js")
            guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: server.path) else {
                throw NSError(domain: "TaskWorkspace", code: 1, userInfo: [NSLocalizedDescriptionKey: "Packaged board runtime is missing"])
            }
            let portFile = dataRoot.appendingPathComponent("board-port")
            let port = try savedPort(at: portFile) ?? 0
            let task = Process()
            task.executableURL = node
            task.arguments = [server.path]
            task.currentDirectoryURL = runtimeRoot
            var environment = ProcessInfo.processInfo.environment
            environment["TASK_WORKSPACE_HOME"] = dataRoot.path
            environment["TASK_WORKSPACE_CODEX_HOME"] = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex").path
            environment["TASK_WORKSPACE_PARENT_STDIN"] = "1"
            environment["PORT"] = String(port)
            environment.removeValue(forKey: "ELECTRON_RUN_AS_NODE")
            let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
            task.environment = environment; task.standardInput = stdin
            task.standardOutput = stdout; task.standardError = stderr
            stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in self?.consume(handle.availableData, portFile: portFile, expectedPort: port) }
            stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in self?.captureError(handle.availableData) }
            task.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.terminated() } }
            try task.run()
            process = task; stdinPipe = stdin
            let timeout = DispatchWorkItem { [weak self, weak task] in
                guard let self, self.currentURL == nil, task?.isRunning == true else { return }
                self.finish(.failure(NSError(domain: "TaskWorkspace", code: 4, userInfo: [NSLocalizedDescriptionKey: "Local board service did not become ready within 10 seconds"])))
                self.stop()
            }
            startupTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
        } catch {
            process = nil; stdinPipe = nil
            finish(.failure(error))
        }
    }

    private var currentURL: URL?

    private func savedPort(at url: URL) throws -> Int? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let text = try String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let port = Int(text), (1024...65535).contains(port) else {
            throw NSError(domain: "TaskWorkspace", code: 2, userInfo: [NSLocalizedDescriptionKey: "Saved board port is invalid"])
        }
        return port
    }

    private func consume(_ data: Data, portFile: URL, expectedPort: Int) {
        guard !data.isEmpty else { return }
        output = String((output + (String(data: data, encoding: .utf8) ?? "")).suffix(4096))
        guard let match = output.range(of: #"Task Workspace: http://127\.0\.0\.1:([0-9]+)"#, options: .regularExpression) else { return }
        let line = String(output[match])
        guard let port = Int(line.split(separator: ":").last ?? ""), (1024...65535).contains(port), expectedPort == 0 || expectedPort == port,
              let url = URL(string: "http://127.0.0.1:\(port)/") else { return }
        if expectedPort == 0 {
            try? Data("\(port)\n".utf8).write(to: portFile, options: .withoutOverwriting)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: portFile.path)
        }
        DispatchQueue.main.async { [weak self] in
            self?.startupTimeout?.cancel(); self?.startupTimeout = nil
            self?.currentURL = url; self?.finish(.success(url))
        }
    }

    private func captureError(_ data: Data) {
        guard !data.isEmpty else { return }
        output = String((output + (String(data: data, encoding: .utf8) ?? "")).suffix(4096))
    }

    private func finish(_ result: Result<URL, Error>) {
        let handlers = completion; completion.removeAll()
        handlers.forEach { $0(result) }
    }

    private func terminated() {
        startupTimeout?.cancel(); startupTimeout = nil
        if currentURL == nil {
            let detail = output.trimmingCharacters(in: .whitespacesAndNewlines)
            finish(.failure(NSError(domain: "TaskWorkspace", code: 3, userInfo: [NSLocalizedDescriptionKey: detail.isEmpty ? "Local board service stopped before startup" : detail])))
        }
        process = nil; stdinPipe = nil; currentURL = nil; output = ""
    }

    func stop() {
        startupTimeout?.cancel(); startupTimeout = nil
        try? stdinPipe?.fileHandleForWriting.close()
        if process?.isRunning == true { process?.terminate() }
        process = nil; stdinPipe = nil; currentURL = nil
    }
}

private final class EntryPanel: NSPanel {
    init(action: Selector, target: AnyObject) {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        level = .floating; isOpaque = false; backgroundColor = .clear; hasShadow = false
        isReleasedWhenClosed = false
        collectionBehavior = [.fullScreenAuxiliary, .transient, .ignoresCycle]
        appearance = NSAppearance(named: .aqua)
        let accent = NSColor(calibratedRed: 0.04, green: 0.48, blue: 0.36, alpha: 1)
        let button = NSButton(title: "工作台", target: target, action: action)
        button.isBordered = false; button.imagePosition = .imageLeading
        button.image = NSImage(systemSymbolName: "rectangle.3.group", accessibilityDescription: "Task Workspace")
        button.image?.isTemplate = true; button.contentTintColor = accent
        button.font = .systemFont(ofSize: 14, weight: .medium)
        button.attributedTitle = NSAttributedString(string: "工作台", attributes: [.font: button.font!, .foregroundColor: NSColor(calibratedWhite: 0.14, alpha: 1)])
        button.alignment = .left; button.translatesAutoresizingMaskIntoConstraints = false
        button.wantsLayer = true
        button.layer?.backgroundColor = accent.withAlphaComponent(0.13).cgColor
        button.layer?.borderColor = accent.withAlphaComponent(0.22).cgColor
        button.layer?.borderWidth = 0.5; button.layer?.cornerRadius = 7
        contentView = NSView(); contentView?.addSubview(button)
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: contentView!.leadingAnchor), button.trailingAnchor.constraint(equalTo: contentView!.trailingAnchor),
            button.topAnchor.constraint(equalTo: contentView!.topAnchor), button.bottomAnchor.constraint(equalTo: contentView!.bottomAnchor)
        ])
    }
}

private final class BoardPanel: NSPanel, WKNavigationDelegate {
    private let webView: WKWebView
    private let status = NSTextField(labelWithString: "正在连接本地看板…")

    init(closeAction: Selector, target: AnyObject) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(contentRect: .zero, styleMask: [.borderless], backing: .buffered, defer: false)
        level = .floating; isOpaque = true; backgroundColor = .windowBackgroundColor; hasShadow = true
        isReleasedWhenClosed = false
        collectionBehavior = [.fullScreenAuxiliary, .transient]
        let root = NSView(), toolbar = NSVisualEffectView()
        toolbar.material = .sidebar; toolbar.blendingMode = .behindWindow; toolbar.state = .active
        let close = NSButton(title: "返回 Codex", target: target, action: closeAction)
        close.bezelStyle = .inline; close.image = NSImage(systemSymbolName: "chevron.left", accessibilityDescription: "Back")
        close.imagePosition = .imageLeading
        for view in [toolbar, close, status, webView] { view.translatesAutoresizingMaskIntoConstraints = false }
        root.addSubview(toolbar); toolbar.addSubview(close); toolbar.addSubview(status); root.addSubview(webView); contentView = root
        NSLayoutConstraint.activate([
            toolbar.leadingAnchor.constraint(equalTo: root.leadingAnchor), toolbar.trailingAnchor.constraint(equalTo: root.trailingAnchor), toolbar.topAnchor.constraint(equalTo: root.topAnchor), toolbar.heightAnchor.constraint(equalToConstant: 42),
            close.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor, constant: 12), close.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
            status.centerXAnchor.constraint(equalTo: toolbar.centerXAnchor), status.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor), webView.trailingAnchor.constraint(equalTo: root.trailingAnchor), webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor), webView.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])
        webView.navigationDelegate = self
    }

    func load(_ url: URL) { status.stringValue = "正在连接本地看板…"; webView.load(URLRequest(url: url)) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { status.stringValue = "工作台 · Workspace" }
    func showError(_ error: Error) { status.stringValue = "无法启动看板：\(error.localizedDescription)" }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let locator = CodexLocator()
    private var entry: EntryPanel!
    private var board: BoardPanel!
    private var service: BoardService!
    private var timer: Timer?
    private var boardVisible = false
    private var hasSeenCodex = false
    private var codexMissingSince: Date?
    private var didLogStartupState = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSLog("Task Workspace sidecar launched")
        guard let resources = Bundle.main.resourceURL else { NSApp.terminate(nil); return }
        NSApp.setActivationPolicy(.accessory)
        service = BoardService(resources: resources)
        entry = EntryPanel(action: #selector(toggleBoard), target: self)
        board = BoardPanel(closeAction: #selector(closeBoard), target: self)
        timer = Timer.scheduledTimer(timeInterval: 0.25, target: self, selector: #selector(sync), userInfo: nil, repeats: true)
        RunLoop.main.add(timer!, forMode: .common)
        sync()
    }

    @objc private func sync() {
        guard let codex = locator.locate() else {
            if !didLogStartupState {
                didLogStartupState = true
                NSLog("Task Workspace cannot locate an on-screen Codex window; frontmost=%@", NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "none")
            }
            entry.orderOut(nil); board.orderOut(nil)
            if hasSeenCodex {
                codexMissingSince = codexMissingSince ?? Date()
                if Date().timeIntervalSince(codexMissingSince!) > 5 { NSApp.terminate(nil) }
            }
            return
        }
        if !didLogStartupState {
            didLogStartupState = true
            NSLog("Task Workspace attached to Codex frame %@; frontmost=%@", NSStringFromRect(codex.frame), NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "none")
        }
        hasSeenCodex = true; codexMissingSince = nil
        let active = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        guard active == officialBundleID || active == Bundle.main.bundleIdentifier else { entry.orderOut(nil); board.orderOut(nil); return }
        let sidebarWidth = min(252, max(210, codex.frame.width * 0.19))
        entry.setFrame(NSRect(x: codex.frame.minX, y: codex.frame.maxY - 100, width: sidebarWidth - 8, height: 34), display: true)
        entry.orderFrontRegardless()
        if boardVisible {
            board.setFrame(NSRect(x: codex.frame.minX + sidebarWidth, y: codex.frame.minY, width: codex.frame.width - sidebarWidth, height: codex.frame.height), display: true)
            board.orderFrontRegardless()
        }
    }

    @objc private func toggleBoard() {
        boardVisible ? closeBoard() : openBoard()
    }

    private func openBoard() {
        boardVisible = true
        NSApp.activate()
        sync(); board.makeKeyAndOrderFront(nil)
        service.start { [weak self] result in
            switch result { case .success(let url): self?.board.load(url); case .failure(let error): self?.board.showError(error) }
        }
    }

    @objc private func closeBoard() {
        boardVisible = false; board.orderOut(nil)
        NSRunningApplication.runningApplications(withBundleIdentifier: officialBundleID).first?.activate()
    }

    func applicationWillTerminate(_ notification: Notification) { timer?.invalidate(); service.stop() }
}

@main
private enum TaskWorkspaceMain {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.run()
    }
}

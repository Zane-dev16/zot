import XCTest
final class ZotAutoPairUITests: XCTestCase {
    var app: XCUIApplication!
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication(bundleIdentifier: "com.zanishlabs.zot")
    }
    func fetchPairCode(server: String) throws -> String {
        let url = URL(string: server + "/api/v1/pair/start")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["label": "xcuitest", "kind": "ios"])
        let exp = expectation(description: "pair start")
        var outCode = ""
        var outError: Error?
        URLSession.shared.dataTask(with: req) { data, resp, err in
            defer { exp.fulfill() }
            if let err = err { outError = err; return }
            guard let data = data else { outError = URLError(.badServerResponse); return }
            do {
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let code = json["code"] as? String {
                    outCode = code
                } else {
                    outError = URLError(.cannotParseResponse)
                }
            } catch {
                outError = error
            }
        }.resume()
        wait(for: [exp], timeout: 10)
        if let e = outError { throw e }
        XCTAssertEqual(outCode.count, 6, "pair code has 6 digits")
        return outCode
    }
    func focusField(_ field: XCUIElement) {
        XCTAssertTrue(field.waitForExistence(timeout: 10), "field exists")
        field.tap()
        sleep(2)
        field.tap()
        sleep(2)
    }
    func clearAndType(_ field: XCUIElement, _ text: String) {
        XCTAssertTrue(field.waitForExistence(timeout: 10), "field exists")
        if let cur = field.value as? String, cur == text { return }
        focusField(field)
        if let cur = field.value as? String, !cur.isEmpty, cur != text, cur != "6 digit code", cur != "Prompt" {
            field.typeText(String(repeating: "\u{8}", count: cur.count))
            sleep(1)
            focusField(field)
        }
        field.typeText(text)
    }
    func testAutoPairAndChat() throws {
        let server = ProcessInfo.processInfo.environment["ZOT_SERVER_URL"] ?? "http://192.168.68.56:8787"
        app.launch()
        sleep(2)
        if app.buttons["Unpair"].waitForExistence(timeout: 5) {
            app.buttons["Unpair"].tap()
            sleep(2)
        }
        XCTAssertTrue(app.buttons["Pair"].waitForExistence(timeout: 10), "pair screen shows Pair")
        let serverField = app.textFields["Base URL"]
        let codeField = app.textFields["6 digit code"]
        XCTAssertTrue(serverField.waitForExistence(timeout: 10), "server field exists")
        XCTAssertTrue(codeField.waitForExistence(timeout: 10), "code field exists")
        clearAndType(serverField, server)
        let code = try fetchPairCode(server: server)
        focusField(codeField)
        codeField.typeText(code)
        sleep(1)
        app.buttons["Pair"].tap()
        var paired = false
        for _ in 0..<6 {
            if app.buttons["Send"].waitForExistence(timeout: 5) { paired = true
                break }
            if app.buttons["Pair"].exists { app.buttons["Pair"].tap() }
            sleep(3)
        }
        if !paired {
            let serverVal = serverField.value as? String ?? "nil"
            let codeVal = codeField.value as? String ?? "nil"
            let texts = app.staticTexts.allElementsBoundByIndex.map { $0.label }.joined(separator: "|")
            XCTAssertTrue(false, "Send missing server=\(serverVal) code=\(codeVal) texts=\(texts)")
        }
        XCTAssertTrue(app.navigationBars["Zot"].waitForExistence(timeout: 10), "paired state shows Zot title")
        let promptField = app.textFields["Prompt"]
        XCTAssertTrue(promptField.waitForExistence(timeout: 10), "prompt field exists")
        for _ in 0..<6 {
            if let v = promptField.value as? String, !v.isEmpty, v != "Prompt" { break }
            promptField.tap()
            sleep(5)
            if let v = promptField.value as? String, v == "hello run" { break }
            promptField.typeText("hello run")
            sleep(2)
        }
        sleep(1)
        app.buttons["Send"].tap()
        sleep(4)
        let hello = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "hello run")).firstMatch
        XCTAssertTrue(hello.waitForExistence(timeout: 30), "chat shows hello run")
    }
}

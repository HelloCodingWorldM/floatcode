import CoreGraphics
import Foundation
// CI-only: place the native cursor where the renderer click is dispatched.
guard CommandLine.arguments.count == 3,
      let x = Double(CommandLine.arguments[1]),
      let y = Double(CommandLine.arguments[2]) else { exit(2) }
exit(CGWarpMouseCursorPosition(CGPoint(x: x, y: y)) == .success ? 0 : 1)

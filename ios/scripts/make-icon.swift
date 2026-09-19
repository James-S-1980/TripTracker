import AppKit

let size = 1024
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()

let background = NSRect(x: 0, y: 0, width: size, height: size)
NSGradient(colors: [
    NSColor(red: 0.06, green: 0.23, blue: 0.27, alpha: 1),
    NSColor(red: 0.04, green: 0.07, blue: 0.10, alpha: 1)
])!.draw(in: background, angle: -45)

let center = NSPoint(x: 512, y: 512)
let orbit = NSBezierPath(ovalIn: NSRect(x: 164, y: 164, width: 696, height: 696))
NSColor(red: 0.31, green: 0.82, blue: 0.77, alpha: 0.11).setFill()
orbit.fill()
NSColor(red: 0.56, green: 0.97, blue: 0.93, alpha: 0.38).setStroke()
orbit.lineWidth = 17
orbit.stroke()

let route = NSBezierPath()
route.move(to: NSPoint(x: 272, y: 362))
route.curve(to: NSPoint(x: 780, y: 746),
            controlPoint1: NSPoint(x: 408, y: 596),
            controlPoint2: NSPoint(x: 580, y: 706))
route.lineCapStyle = .round
route.lineWidth = 35
NSColor(red: 0.31, green: 0.82, blue: 0.77, alpha: 1).setStroke()
route.stroke()

for (point, radius) in [(NSPoint(x: 272, y: 362), 36.0), (NSPoint(x: 780, y: 746), 45.0)] {
    NSColor(red: 0.62, green: 0.96, blue: 0.93, alpha: 1).setFill()
    NSBezierPath(ovalIn: NSRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)).fill()
}

var transform = AffineTransform(translationByX: center.x, byY: center.y)
transform.rotate(byDegrees: -30)
let plane = NSBezierPath()
plane.move(to: NSPoint(x: 0, y: 190))
plane.line(to: NSPoint(x: 28, y: 30))
plane.line(to: NSPoint(x: 150, y: -42))
plane.line(to: NSPoint(x: 150, y: -85))
plane.line(to: NSPoint(x: 20, y: -48))
plane.line(to: NSPoint(x: 18, y: -150))
plane.line(to: NSPoint(x: 60, y: -182))
plane.line(to: NSPoint(x: 60, y: -205))
plane.line(to: NSPoint(x: 0, y: -190))
plane.line(to: NSPoint(x: -60, y: -205))
plane.line(to: NSPoint(x: -60, y: -182))
plane.line(to: NSPoint(x: -18, y: -150))
plane.line(to: NSPoint(x: -20, y: -48))
plane.line(to: NSPoint(x: -150, y: -85))
plane.line(to: NSPoint(x: -150, y: -42))
plane.line(to: NSPoint(x: -28, y: 30))
plane.close()
plane.transform(using: transform)
NSColor.white.setFill()
plane.fill()

image.unlockFocus()
guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not render app icon")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
let resize = Process()
resize.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
resize.arguments = ["-z", "1024", "1024", CommandLine.arguments[1]]
resize.standardOutput = FileHandle.nullDevice
try resize.run()
resize.waitUntilExit()
guard resize.terminationStatus == 0 else { fatalError("Could not resize app icon") }

// Local IPv4 addresses, shown in the UI so a PC can connect by address.
import Foundation

public enum NetInfo {
  public static func ipv4Addresses() -> [(interface: String, address: String)] {
    var result: [(String, String)] = []
    var ifaddr: UnsafeMutablePointer<ifaddrs>? = nil
    guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return [] }
    defer { freeifaddrs(ifaddr) }
    for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
      let ifa = ptr.pointee
      guard let sa = ifa.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) else { continue }
      let flags = Int32(ifa.ifa_flags)
      guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
      let name = String(cString: ifa.ifa_name)
      // Skip VPN / tunnel / bridge interfaces: a PC cannot reach those addresses.
      if name.hasPrefix("utun") || name.hasPrefix("ipsec") || name.hasPrefix("bridge") || name.hasPrefix("pdp_ip") || name.hasPrefix("awdl") || name.hasPrefix("llw") { continue }
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      if getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
        result.append((name, String(cString: host)))
      }
    }
    // en0 (Wi-Fi) first, then USB/ethernet-style interfaces, then the rest.
    return result.sorted { a, b in
      let rank: (String) -> Int = { $0 == "en0" ? 0 : $0.hasPrefix("en") ? 1 : 2 }
      return rank(a.0) == rank(b.0) ? a.0 < b.0 : rank(a.0) < rank(b.0)
    }
  }
}

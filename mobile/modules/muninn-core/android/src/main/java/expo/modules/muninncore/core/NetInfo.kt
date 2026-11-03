// Local IPv4 addresses for the UI, and the address a client is reachable at.
package expo.modules.muninncore.core

import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface

object NetInfo {
  /** ("wlan0", "10.0.0.5") pairs, Wi-Fi first, then USB/ethernet, then the rest. */
  fun ipv4Addresses(): List<Pair<String, String>> {
    val out = mutableListOf<Pair<String, String>>()
    val ifaces = try { NetworkInterface.getNetworkInterfaces()?.toList() } catch (_: Exception) { null } ?: return out
    for (nif in ifaces) {
      if (!nif.isUp || nif.isLoopback) continue
      val name = nif.name
      if (name.startsWith("tun") || name.startsWith("ppp") || name.startsWith("dummy") || name.startsWith("p2p")) continue
      for (addr in nif.inetAddresses) {
        if (addr is Inet4Address && !addr.isLoopbackAddress) out += name to (addr.hostAddress ?: continue)
      }
    }
    fun rank(n: String) = when {
      n.startsWith("wlan") -> 0
      n.startsWith("eth") || n.startsWith("usb") || n.startsWith("rndis") || n.startsWith("ncm") -> 1
      else -> 2
    }
    return out.sortedWith(compareBy({ rank(it.first) }, { it.first }))
  }

  /**
   * Where to send UDP for a client that connected from `remote`.
   *
   * On the emulator a PC connects through `adb forward`, so its control connection
   * appears to come from 127.0.0.1 inside the guest; datagrams sent there would never
   * leave the emulator. 10.0.2.2 is the emulator's alias for the host's loopback, so
   * UDP reaches the PC as long as it runs on the same machine as the emulator.
   */
  fun udpTarget(remote: InetAddress): InetAddress {
    if (remote.isLoopbackAddress && LocalDeviceInfo.isEmulator) {
      return InetAddress.getByName("10.0.2.2")
    }
    return remote
  }
}

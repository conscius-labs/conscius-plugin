/**
 * Whether an IP address is on the public internet: the fetcher's guard against requests to internal
 * hosts (fetcher.mjs vet()), and the screen's on a source's host (screen.mjs privateHost). IPv6 is
 * read as its 16 bytes, never as text: the URL parser writes http://[::ffff:127.0.0.1]/ as
 * ::ffff:7f00:1, so a pattern on the dotted form lets every IPv4 address through (the security review
 * of 2026-11-03, brief 86). An address carrying an IPv4 one is judged by that one.
 *
 * plugin/hooks/ip.mjs is a copy, since the plugin ships without server/ (plugin/hooks/test.mjs checks
 * the two stay the same).
 */
import net from "node:net";

function publicIPv4(ip) {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if ((a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  if ((a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false;
  return true;
}

/** A valid IPv6 address's 16 bytes, in any notation: compressed or not, a dotted tail, a zone. */
function ipv6Bytes(ip) {
  const s = ip.split("%")[0].toLowerCase().replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) => `${((+a << 8) | +b).toString(16)}:${((+c << 8) | +d).toString(16)}`);
  const groups = (part) => (part ? part.split(":").map((g) => parseInt(g, 16)) : []);
  const [head, tail] = s.split("::");
  const h = groups(head);
  const t = groups(tail);
  return [...h, ...Array(8 - h.length - t.length).fill(0), ...t].flatMap((g) => [g >> 8, g & 255]);
}

const zero = (bytes) => bytes.every((x) => x === 0);

function publicIPv6(ip) {
  const b = ipv6Bytes(ip);
  const v4 = (at) => publicIPv4(b.slice(at, at + 4).join("."));
  const ffff = (at) => b[at] === 255 && b[at + 1] === 255;
  if (zero(b.slice(0, 10)) && ffff(10)) return v4(12); // ::ffff:0:0/96, IPv4-mapped
  if (zero(b.slice(0, 12))) return v4(12); // ::/96, IPv4-compatible, with :: and ::1 (0.0.0.0 and 0.0.0.1)
  if (zero(b.slice(0, 8)) && ffff(8) && zero(b.slice(10, 12))) return v4(12); // ::ffff:0:0:0/96, IPv4-translated
  if (b[0] === 0x20 && b[1] === 0x02) return v4(2); // 2002::/16, 6to4
  // Only global unicast is public; the rest of IPv6 (fc00::/7, fe80::/10, fec0::/10, ff00::/8, 64:ff9b::/32, 100::/64) is not
  if ((b[0] & 0xe0) !== 0x20) return false;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] <= 1) return false; // 2001::/23: Teredo, which hides an IPv4 address, and special purposes
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false; // 2001:db8::/32, documentation
  if (b[0] === 0x3f && b[1] === 0xff && b[2] >> 4 === 0) return false; // 3fff::/20, documentation
  return true;
}

export function publicAddress(ip) {
  const v = net.isIP(ip);
  return v === 4 ? publicIPv4(ip) : v === 6 ? publicIPv6(ip) : false;
}

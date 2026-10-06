import { address, port, type Join } from './data.ts'

export type Hub = { host: string; publicKey: string; sshKey: string }

// The node runs this as `curl … | sudo sh`, so the whole script is one function, called on
// its last line: a download cut short runs nothing, and nothing it runs can read the rest as input.
export function joinScript(join: Join, hub: Hub) {
  return `#!/bin/sh
set -eu

main() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q wireguard-tools openssh-server nftables
  echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-postern.conf
  sysctl -q -p /etc/sysctl.d/99-postern.conf

  umask 077
  mkdir -p /etc/wireguard /root/.ssh
  cat > /etc/wireguard/postern0.conf <<'EOF'
[Interface]
Address = ${address(join)}/32
PrivateKey = ${join.privateKey}

[Peer]
PublicKey = ${hub.publicKey}
Endpoint = ${hub.host}:51820
AllowedIPs = 10.99.0.1/32
PersistentKeepalive = 25
EOF
  if ! grep -qxF '${hub.sshKey}' /root/.ssh/authorized_keys 2>/dev/null; then
    echo '${hub.sshKey}' >> /root/.ssh/authorized_keys
  fi
  if [ ! -f /etc/wireguard/wg0.conf ]; then
    cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address = 10.66.66.1/24
ListenPort = ${port(join)}
MTU = 1340
PrivateKey = $(wg genkey)
PostUp = nft add table inet postern; nft add chain inet postern postrouting '{ type nat hook postrouting priority srcnat; }'; nft add rule inet postern postrouting 'ip saddr 10.66.66.0/24 oifname != { "wg0", "postern0" } masquerade'
PostDown = nft delete table inet postern
EOF
  fi
  sed -i 's/^ListenPort = .*/ListenPort = ${port(join)}/' /etc/wireguard/wg0.conf

  systemctl enable wg-quick@postern0
  systemctl restart wg-quick@postern0
  systemctl enable --now ssh
  systemctl enable wg-quick@wg0
  systemctl restart wg-quick@wg0
  echo 'Joined VPN Postern as ${address(join)}.'
}

main
`
}

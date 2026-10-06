#!/usr/bin/env bash
# Installs, updates or resets the VPN Postern hub on Ubuntu:
#   curl -fsSL https://github.com/gurhankokcu/vpn-postern/releases/latest/download/install.sh | sudo bash
# POSTERN_SOURCE=DIR installs from the working copy at DIR instead of the latest release.
set -euo pipefail

release=https://github.com/gurhankokcu/vpn-postern/releases/latest/download
data=/var/lib/postern
packages=(wireguard-tools nftables openssl qrencode)

stop() {
  echo 'Stopped. Nothing was changed.' >&2
  exit 1
}

confirm() {
  local answer
  read -r -p "$1 [y/N] " answer < /dev/tty
  if [[ $answer != [yY]* ]]; then
    stop
  fi
}

# The whole script is one function, called on its last line, so a download cut
# short by curl runs nothing, and nothing it runs can read the rest as input.
main() {
  if [ "$(id -u)" -ne 0 ]; then
    echo 'Run as root.' >&2
    exit 1
  fi

  choice=install
  if [ -e /opt/postern ] || [ -e "$data" ]; then
    read -r -p 'VPN Postern is already installed. [u]pdate, keeping nodes and users / [r]eset, erasing everything / [c]ancel: ' answer < /dev/tty
    case $answer in
      [uU]*) choice=update ;;
      [rR]*) choice=reset ;;
      *) stop ;;
    esac
  fi

  missing=()
  for package in "${packages[@]}"; do
    if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'ok installed'; then
      missing+=("$package")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    confirm "Install ${missing[*]} with apt?"
  fi

  node=present
  if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
    confirm "Node.js 24 is not installed (found $(node --version 2>/dev/null || echo none)). Install it from nodejs.org into /usr/local?"
    node=missing
  fi

  password=
  if [ "$choice" = reset ] || [ ! -f "$data/data.json" ]; then
    while true; do
      IFS= read -r -s -p 'Admin password: ' password < /dev/tty
      echo
      length=$(LC_ALL=C.UTF-8; echo ${#password})
      if [ "$length" -lt 12 ] || [ "$length" -gt 256 ]; then
        echo 'A password is 12 to 256 characters.'
        continue
      fi
      IFS= read -r -s -p 'Again: ' again < /dev/tty
      echo
      if [ "$password" = "$again" ]; then
        break
      fi
      echo "Passwords don't match."
    done
  fi

  if [ "$choice" = reset ]; then
    echo '==> Erasing VPN Postern'
    if [ -f /etc/systemd/system/postern.service ]; then
      systemctl disable --now postern
    fi
    if [ -f /etc/wireguard/postern0.conf ]; then
      systemctl disable --now wg-quick@postern0
    fi
    rm -rf /etc/systemd/system/postern.service /etc/wireguard/postern0.conf /usr/local/bin/postern /opt/postern "$data"
    systemctl daemon-reload
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    echo '==> Packages'
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -q
    apt-get install -y -q "${missing[@]}"
  fi

  if [ "$node" = missing ]; then
    echo '==> Node.js 24'
    case "$(uname -m)" in
      x86_64) arch=x64 ;;
      aarch64) arch=arm64 ;;
      *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac
    dist=https://nodejs.org/dist/latest-v24.x
    file=$(curl -fsSL "$dist/SHASUMS256.txt" | grep -o "node-v24\.[0-9.]*-linux-$arch\.tar\.gz" | head -n 1)
    dir=${file%.tar.gz}
    curl -fsSL "$dist/$file" | tar -xz --no-same-owner -C /usr/local --strip-components=1 "$dir/bin" "$dir/include" "$dir/lib" "$dir/share"
  fi

  echo '==> VPN Postern'
  new=$(mktemp -d)
  if [ -n "${POSTERN_SOURCE:-}" ]; then
    tar -C "$POSTERN_SOURCE" --exclude='*.test.ts' -cz package.json src
  else
    curl -fsSL "$release/postern.tar.gz"
  fi | tar -xz --no-same-owner -C "$new"
  chmod 755 "$new"
  rm -rf /opt/postern
  mv "$new" /opt/postern

  cat > /usr/local/bin/postern <<'EOF'
#!/bin/sh
cd /opt/postern && POSTERN_DIR=/var/lib/postern exec node "src/$1.ts"
EOF
  chmod 755 /usr/local/bin/postern

  mkdir -p "$data"
  chmod 700 "$data"
  if [ ! -f "$data/id_ed25519" ]; then
    ssh-keygen -q -t ed25519 -N '' -C postern -f "$data/id_ed25519"
  fi
  if [ ! -f /etc/wireguard/postern0.conf ]; then
    (
      umask 077
      printf '[Interface]\nAddress = 10.99.0.1/24\nListenPort = 51820\nPrivateKey = %s\n' "$(wg genkey)" > /etc/wireguard/postern0.conf
    )
  fi
  systemctl enable --now wg-quick@postern0
  echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-postern.conf
  sysctl -q -p /etc/sysctl.d/99-postern.conf
  if [ ! -f "$data/tls.crt" ]; then
    postern cert
  fi
  if [ -n "$password" ]; then
    printf '%s\n' "$password" | postern set-password
  fi

  cat > /etc/systemd/system/postern.service <<'EOF'
[Unit]
Description=VPN Postern
After=network-online.target wg-quick@postern0.service
Wants=network-online.target

[Service]
ExecStartPre=/usr/local/bin/postern nft
ExecStart=/usr/local/bin/postern server
Restart=always

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable postern
  systemctl restart postern

  echo "VPN Postern is running at https://$(hostname -I | awk '{print $1}'):8443"
}

main "$@"

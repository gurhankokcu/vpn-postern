#!/bin/sh
set -eu

# A router trades Docker's placeholder address for its own on the LAN side.
ip addr flush dev lan
ip addr add "${LAN%.*}.1/24" dev lan

iptables -P FORWARD DROP
iptables -A FORWARD -i lan -o wan -j ACCEPT
iptables -A FORWARD -i wan -o lan -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

case "$NAT" in
  endpoint-independent) iptables -t nat -A POSTROUTING -s "$LAN" -o wan -j MASQUERADE ;;
  symmetric)            iptables -t nat -A POSTROUTING -s "$LAN" -o wan -j MASQUERADE --random ;;
esac

exec sleep infinity

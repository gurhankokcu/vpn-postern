#!/bin/sh
set -eu

# Docker's gateway leads to the real LAN and internet; the simulation leads
# only to itself.
ip route del default

# A LAN host trades Docker's placeholder address for its own and goes out
# through its router, always at .1.
if [ -n "${ADDRESS:-}" ]; then
  ip addr flush dev eth0
  ip addr add "$ADDRESS" dev eth0
  ip route add default via "${ADDRESS%.*}.1"
fi

exec "$@"

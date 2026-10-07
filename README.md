# VPN Postern

Self-hosted VPN access to networks behind NAT, with zero router configuration.

Manage home nodes (a Raspberry Pi, a NAS, any Linux box) behind NAT from one droplet.
Each node becomes a WireGuard VPN server. Phones reach it through the droplet.

## How it works

| Term       | Meaning                                               |
| ---------- | ----------------------------------------------------- |
| Hub        | the droplet: web UI, management tunnel, port forwards |
| Node       | Linux box at home, behind NAT (e.g. a Raspberry Pi)   |
| Device     | a phone/laptop with a WireGuard config for one node   |
| `postern0` | management tunnel, hub ↔ nodes                        |
| `wg0`      | the node's VPN server, for devices                    |

```
phone ──▶ hub:P/udp ══ postern0 ══▶ node:L (wg0) ──▶ home LAN, internet
          DNAT only                  decrypts
```

- Each node dials the hub on `postern0`, which keeps its NAT open, so the hub reaches it at `10.99.0.N`.
- Each node has its own UDP port `P` on the hub. One nftables rule forwards it to the node's `wg0`; the hub never decrypts device traffic.
- A node's devices live only in its `/etc/wireguard/wg0.conf`. The hub stores nothing about them.
- The hub manages nodes over SSH through `postern0`. Nothing custom runs on a node.
- The hub keeps its data in one file, `/var/lib/postern/data.json`: the admin password hash, the nodes and the join tokens.

## Try it in the simulation

```sh
npm run sim:up                    # a small internet in Docker Desktop
docker exec -it hub bash          # the droplet, as root
POSTERN_SOURCE=/mnt/project bash /mnt/project/install.sh
```

The admin UI is then at `https://localhost:8443`. The simulation is described in
`test/sim/README.md`.

## Run it locally

```sh
npm run cert                                                  # TLS certificate
npm run set-password                                          # admin password
ssh-keygen -q -t ed25519 -N '' -C postern -f .dev/id_ed25519  # hub SSH key
npm run server                                                # https://localhost:8443
```

Data lives in `.dev`. `dev/bin/wg` stands in for WireGuard: nodes show offline
unless `.dev/handshakes` lists their key and last handshake time.

## Test

```sh
npm test     # unit tests
npm run e2e  # end to end, in the simulation
```

The last e2e file drives the UI in the installed Google Chrome, headless.

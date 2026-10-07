# VPN Postern

Self-hosted VPN access to networks behind NAT, with zero router configuration.

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

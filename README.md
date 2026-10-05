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

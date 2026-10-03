# The simulation

A small internet in Docker Desktop: one droplet, two homes behind NATs, a phone
on mobile data. Every machine starts as it would on day one. Nothing of VPN
Postern is installed; that is for you to do, as on the real thing.

```sh
docker compose up -d --build --wait   # build and start every machine
./verify.ts                           # check every promise
docker compose down                   # throw the world away
```

| Machine              | Starts as                                               |
| -------------------- | ------------------------------------------------------- |
| `hub`                | a fresh DigitalOcean droplet: Ubuntu, systemd, sshd     |
| `home-pi`, `work-pi` | a fresh Raspberry Pi: Debian, systemd, sshd, `pi`       |
| `laptop`, `desktop`  | clients on each home LAN                                |
| `camera`, `printer`  | devices with a web page on each home LAN                |
| `phone`, `tablet`    | WireGuard clients, behind a carrier NAT and behind none |
| `example.com`        | the open internet                                       |

The internet is down, so what VPN Postern installs waits in apt's cache on the
hub and the Pis: `apt-get install` finds it missing and succeeds. Node.js is on
the hub already, and the hub finds this repository at `/mnt/postern`, as if
downloaded. The admin UI, once installed, is at `https://localhost:8443`.

```sh
docker exec -it hub bash          # the droplet, as root
docker exec -it home-pi su - pi   # the Pi, as its user
```

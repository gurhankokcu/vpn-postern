FROM node:24-alpine

RUN apk add --no-cache iproute2 iptables nftables conntrack-tools tcpdump iputils curl \
      wireguard-tools openssh-client

COPY --chmod=755 net.sh router.sh web.ts /usr/local/bin/

ENTRYPOINT ["net.sh"]
CMD ["sleep", "infinity"]

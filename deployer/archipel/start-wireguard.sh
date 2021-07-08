#!/bin/bash

#prefix output
# setup fd-3 to point to the original stdout
exec 3>&1
# setup fd-4 to point to the original stderr
exec 4>&2
# get the prefix from SUPERVISOR_PROCESS_NAME environement variable
printf -v PREFIX "%-10.10s" ${SUPERVISOR_PROCESS_NAME}
# reassign stdout and stderr to a preprocessed and redirected to the original stdout/stderr (3 and 4) we have create eralier
exec 1> >( perl -ne '$| = 1; print "'"${PREFIX}"' | $_"' >&3)
exec 2> >( perl -ne '$| = 1; print "'"${PREFIX}"' | $_"' >&4)

#detect error in piped command
set -eo pipefail

#functions
function check_cmd {
      if [ "$1" != "0" ]; then
            echo "Error! Can't execute command to $2."
            exit 1
      fi
}

function check_result {
      if [ "$1" == "null" ]; then
            echo "Error! Config for '$2' not found"
            exit 1
      fi
}

#parsing config file
if [ ! -z "$CONFIG_FILE" ]; then
    if [ -z "$NODE_ID" ]; then
        echo "\$NODE_ID must be set"
        exit 1
    fi

    #unpack config file
    if [ -f "/config/archipel-config.zip" ]; then
          echo "Unzip archipel-config.zip file from /config directory."
          #if config file password was set unzip with password
          if [ ! -z "$CONFIG_FILE_PASSWORD" ]; then
                if [ ! -z "$DEBUG" ]; then
                      echo "Unzip if first time with -u option."
                fi
                unzip -u -P "$CONFIG_FILE_PASSWORD" -o /config/archipel-config.zip -d /config
                if [ ! -z "$DEBUG" ]; then
                      echo "Refresh all configs files with unzip -f option."
                fi
                unzip -f -P "$CONFIG_FILE_PASSWORD" -o /config/archipel-config.zip -d /config
          else
                if [ ! -z "$DEBUG" ]; then
                      echo "Unzip if first time  with -u option."
                fi
                unzip -u -o /config/archipel-config.zip -d /config
                if [ ! -z "$DEBUG" ]; then
                      echo "Refresh all configs files with unzip -f option."
                fi
                unzip -f -o /config/archipel-config.zip -d /config
          fi
    else
          echo "No config file found in /config/archipel-config.zip"
          exit 1
    fi

    #check if node id is valid
    NODES_NUMBER=$(cat /config/config.json | jq ".nodesNumber")
    if [ "$NODE_ID" -eq "0" ] || [ "$NODE_ID" -gt "$NODES_NUMBER" ]; then
        echo "Invalid node number! Node number must be between 1 and $NODES_NUMBER..."
        exit 1
    fi

    #set variables from config file if they are not set
    if [ -z "$WIREGUARD_PRIVATE_KEY" ]; then
        WIREGUARD_PRIVATE_KEY=$(cat /config/config.json | jq ".wireguardNodes[$(( $NODE_ID - 1))].privateKey" | sed 's/\"//g')
        #check result and if config was extracted successfully
        check_cmd $? 'retrieve WIREGUARD_PRIVATE_KEY'
        check_result $WIREGUARD_PRIVATE_KEY 'WIREGUARD_PRIVATE_KEY'
    fi
    if [ -z "$WIREGUARD_ADDRESS" ]; then
        WIREGUARD_ADDRESS="10.0.1.$NODE_ID/32"
    fi
    if [ -z "$WIREGUARD_LISTEN_PORT" ]; then
        WIREGUARD_LISTEN_PORT="51820"
    fi
    if [ -z "$WIREGUARD_PEERS_EXTERNAL_ADDR" ]; then
        WIREGUARD_PEERS_EXTERNAL_ADDR=$(cat /config/config.json | jq ".wireguardExternalAddrList" | sed 's/\"//g')
        check_cmd $? 'retrieve WIREGUARD_PEERS_EXTERNAL_ADDR'
        check_result $WIREGUARD_PEERS_EXTERNAL_ADDR 'WIREGUARD_PEERS_EXTERNAL_ADDR'
    fi
    if [ -z "$WIREGUARD_PEERS_PUB_ADDR" ]; then
        WIREGUARD_PEERS_PUB_ADDR=$(cat /config/config.json | jq ".wireguardPeersPubAddrList" | sed 's/\"//g')
        check_cmd $? 'retrieve WIREGUARD_PEERS_PUB_ADDR'
        check_result $WIREGUARD_PEERS_PUB_ADDR 'WIREGUARD_PEERS_PUB_ADDR'
    fi
    if [ -z "$WIREGUARD_PEERS_ALLOWED_IP" ]; then
        WIREGUARD_PEERS_ALLOWED_IP=$(cat /config/config.json | jq ".wireguardAllowedIpsList" | sed 's/\"//g')
        check_cmd $? 'retrieve WIREGUARD_PEERS_ALLOWED_IP'
        check_result $WIREGUARD_PEERS_ALLOWED_IP 'WIREGUARD_PEERS_ALLOWED_IP'
    fi
fi

# Checking env vars
if [ -z $WIREGUARD_PRIVATE_KEY ] || [ -z $WIREGUARD_ADDRESS ] || \
    [ -z $WIREGUARD_LISTEN_PORT ] ||  [ -z $WIREGUARD_PEERS_EXTERNAL_ADDR ] || \
    [ -z $WIREGUARD_PEERS_PUB_ADDR ] || [ -z $WIREGUARD_PEERS_ALLOWED_IP ]; then
    echo "ERROR: Please set env vars WIREGUARD_PRIVATE_KEY, WIREGUARD_ADDRESS, WIREGUARD_LISTEN_PORT, WIREGUARD_PEERS_PUB_ADDR, WIREGUARD_PEERS_ALLOWED_IP, WIREGUARD_PEERS_EXTERNAL_ADDR." >&2
    exit 1
fi

# Replace , with spaces in PEERS lists
IFS=',' read -r -a WIREGUARD_PEERS_PUB_ADDR_SPACE <<< "$WIREGUARD_PEERS_PUB_ADDR"
IFS=',' read -r -a WIREGUARD_PEERS_ALLOWED_IP_SPACE <<< "$WIREGUARD_PEERS_ALLOWED_IP"
IFS=',' read -r -a WIREGUARD_PEERS_EXTERNAL_ADDR_SPACE <<< "$WIREGUARD_PEERS_EXTERNAL_ADDR"

# Check if length of peers arrays are the same
if [[ "$(wc -w <<< "${WIREGUARD_PEERS_PUB_ADDR_SPACE[@]}")" !=  "$(wc -w <<< "${WIREGUARD_PEERS_ALLOWED_IP_SPACE[@]}")" ]] || \
   [[ "$(wc -w <<< "${WIREGUARD_PEERS_PUB_ADDR_SPACE[@]}")" !=  "$(wc -w <<< "${WIREGUARD_PEERS_EXTERNAL_ADDR_SPACE[@]}")" ]]; then
   echo "ERROR: Please check WIREGUARD_PEERS_PUB_ADDR_SPACE, WIREGUARD_PEERS_ALLOWED_IP_SPACE, WIREGUARD_PEERS_EXTERNAL_ADDR_SPACE lists length." >&2
   exit 1
fi

# Write server config
cat <<EOF >/etc/wireguard/wg0.conf
[Interface]
Address = $WIREGUARD_ADDRESS
PrivateKey = $WIREGUARD_PRIVATE_KEY
ListenPort = $WIREGUARD_LISTEN_PORT

EOF

# Add peers into config file
for i in "${!WIREGUARD_PEERS_PUB_ADDR_SPACE[@]}"; do
    # Don't add server as peer
    if [[ "${WIREGUARD_PEERS_ALLOWED_IP_SPACE[i]}" != "$WIREGUARD_ADDRESS" ]]; then
    cat <<EOF >>/etc/wireguard/wg0.conf
[Peer]
PublicKey = ${WIREGUARD_PEERS_PUB_ADDR_SPACE[i]}
AllowedIPs = ${WIREGUARD_PEERS_ALLOWED_IP_SPACE[i]}
Endpoint = ${WIREGUARD_PEERS_EXTERNAL_ADDR_SPACE[i]}
PersistentKeepalive = 21

EOF
    fi
done

# Find a Wireguard interface
interfaces=`find /etc/wireguard -type f`
if [[ -z $interfaces ]]; then
    echo "$(date): Interface not found in /etc/wireguard" >&2
    exit 1
fi

# Up wireguard for every interface
for interface in $interfaces; do
    echo "$(date): Starting Wireguard $interface"
    wg-quick up $interface
done

# Handle shutdown behavior
finish () {
    echo "$(date): Shutting down Wireguard"
    for interface in $interfaces; do
        wg-quick down $interface
    done
    exit 0
}

# Catch shutdown signals
trap finish SIGTERM SIGINT SIGQUIT

# Make script run forever
sleep infinity &
wait $!

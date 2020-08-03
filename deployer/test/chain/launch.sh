#!/bin/bash
ARCHIPEL_CHAIN_VERSION="test"
# Launch Archipel node in docker container
function launch_node () {
  echo "Starting $1..."
  # Launching docker container of node
  docker run -d --name "$1" $3 \
    -v $1:/root/chain/data \
    --network archipel \
    --ip "$2" \
    --env ARCHIPEL_NODE_ALIAS=$1 \
    --env ARCHIPEL_KEY_SEED="$4" \
    --env ARCHIPEL_RESERVED_PEERS="$5" \
    --env ARCHIPEL_AUTHORITIES_SR25519_LIST="5FmqMTGCW6yGmqzu2Mp9f7kLgyi5NfLmYPWDVMNw9UqwU2Bs,5H19p4jm177Aj4X28xwL2cAAbxgyAcitZU5ox8hHteScvsex,5DqDvHkyfyBR8wtMpAVuiWA2wAAVWptA8HtnsvQT7Uacbd4s" \
    --env ARCHIPEL_AUTHORITIES_ED25519_LIST="5FbQNUq3kDC9XHtQP6iFP5PZmug9khSNcSRZwdUuwTz76yQY,5GiUmSvtiRtLfPPAVovSjgo6NnDUDs4tfh6V28RgZQgunkAF,5EGkuW6uSqiZZiZCyVfQZB9SKw5sQc4Cok8kP5aGEq3mpyVj" \
    luguslabs/archipel-chain:$ARCHIPEL_CHAIN_VERSION

  echo "Waiting 5 seconds to be sure that node was started..."
  sleep 5
}

# Get local node identity
function get_node_identity () {
  echo "Getting local $1 identity..."
  # Make this trick to be able to return a result from a function in bash
  local  __resultvar=$2
  local node_local_id=$(docker logs $1 2>&1 | grep "Local node identity is" | tail -1 | grep -oE '[^ ]+$' --color=never)
  eval $__resultvar="'$node_local_id'"
}

NODE1_IP="172.28.42.2"
NODE2_IP="172.28.42.3"
NODE3_IP="172.28.42.4"

# Creating a docker network for Archipel chain
echo "Creating docker network for archipel chain test..."
docker network create archipel --subnet=172.28.42.0/16

docker volume create node1
docker volume create node2
docker volume create node3

# Starting node1
launch_node "node1" \
            "$NODE1_IP" \
            "-p 9944:9944 -p 9933:9933 -p 9955:9955" \
            "mushroom ladder bomb tornado clown wife bean creek axis flat pave cloud" \
            ""

# Starting node2
launch_node "node2" \
            "$NODE2_IP" \
            "" \
            "fiscal toe illness tunnel pill spatial kind dash educate modify sustain suffer" \
            ""

# Starting node3
launch_node "node3" \
            "$NODE3_IP" \
            "" \
            "borrow initial guard hunt corn trust student opera now economy thumb argue" \
            ""

echo "Chain is fully initilized!"
docker ps
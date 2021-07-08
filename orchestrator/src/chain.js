const { ApiPromise, WsProvider } = require('@polkadot/api');
const debug = require('debug')('chain');

const { getKeysFromSeed, fromModeToNodeStatus } = require('./utils');

class Chain {
  constructor (wsProvider, role) {
    this.wsProvider = wsProvider;
    this.heartbeatSendEnabled = true;
    this.heartbeatSendEnabledAdmin = true;
    this.role = role;
  }

  async connect () {
    try {
      // Creating Websocket Provider
      const provider = new WsProvider(this.wsProvider);
      // Creating API
      this.api = await ApiPromise.create({
        provider,
        types: {
          // mapping the actual specified address format
          Address: 'AccountId',
          // mapping the lookup
          LookupSource: 'AccountId'
        }
      });
      this.provider = provider;
      // Retrieve the chain & node information information via rpc calls
      const [chain, nodeName, nodeVersion] = await Promise.all([
        this.api.rpc.system.chain(),
        this.api.rpc.system.name(),
        this.api.rpc.system.version()
      ]);

      console.log(`You are connected to chain ${chain} using ${nodeName} v${nodeVersion}`);
    } catch (error) {
      debug('constructor', error);
      throw error;
    }
  }

  // Show transaction status in debug
  transactionShowStatus (status, where) {
    if (status.isInvalid) debug(where, 'Transaction is invalid.');
    if (status.isDropped) debug(where, 'Transaction is dropped.');
    if (status.isUsurped) debug(where, 'Transaction is usurped.');
    if (status.isReady) debug(where, 'Transaction is ready.');
    if (status.isFuture) debug(where, 'Transaction is future.');
    if (status.isFinalized) debug(where, 'Transaction is finalized.');
    if (status.isBroadcast) debug(where, 'Transaction is broadcast.');
  }

  // Listen events
  async listenEvents (heartbeats, orchestrator, mnemonic) {
    try {
      const keys = await getKeysFromSeed(mnemonic);
      // Subscribe to events
      await this.api.query.system.events((events) => {
        // Loop through events
        events.forEach(({ event = [] }) => {
          // If change leader event received
          if (event.section.toString() === 'archipelModule' && event.method.toString() === 'NewLeader') {
            debug('listenEvents', `Received new leader event from ${event.data[0].toString()}`);
            // If anyone other took leadership
            if (event.data[0].toString() !== keys.address.toString()) {
              if (this.role === 'operator') {
                console.log('Forcing service in passive mode...');
                orchestrator.serviceStart('passive');
              } else {
                console.log('Forcing service in sentry mode...');
                orchestrator.serviceStart('sentry');
              }
            }
          }
          // Add heartbeat if NewHeartbeat event was received
          if (event.section.toString() === 'archipelModule' && event.method.toString() === 'NewHeartbeat') {
            debug('listenEvents', `Received NewHeartbeat event from ${event.data[0].toString()}`);
            heartbeats.addHeartbeat(event.data[0].toString(), event.data[1].toString(), event.data[2].toString(), event.data[3].toString());
          }
        });
      });
    } catch (error) {
      debug('listenEvents', error);
      throw error;
    }
  }

  // If node state permits to send transactions
  async canSendTransactions () {
    try {
      // Get peers number
      let peersNumber = await this.getPeerNumber();
      debug('canSendTransactions', `Node has ${peersNumber} peers.`);

      // Get sync state
      let syncState = await this.getSyncState();
      debug('canSendTransactions', `Node is sync: ${syncState}`);

      if (peersNumber === 0 || syncState === true) {
        console.log(`Peers number is ${peersNumber} and Sync State is ${syncState}. We will retry in 5 seconds.`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        peersNumber = await this.getPeerNumber();
        syncState = await this.getSyncState();
        console.log(`After retry peers number is ${peersNumber} and Sync State is ${syncState}.`);
      }

      // If node has any peers and is not in synchronizing chain
      return peersNumber !== 0 && syncState !== true;
    } catch (error) {
      debug('canSendTransactions', error);
      throw error;
    }
  }

  // Send heartbeat
  async addHeartbeat (groupId, mode, mnemonic) {
    try {
      // Checking if heartbeats send is enabled
      console.log('Checking if heartbeats send is enabled...');
      if (!this.heartbeatSendEnabled || !this.heartbeatSendEnabledAdmin) {
        console.log('Heartbeat send is disabled...');
        return;
      }

      const nodeStatus = await fromModeToNodeStatus(mode);
      // If node state permits to send transactions
      const sendTransaction = await this.canSendTransactions();

      // If node has any peers and is not in synchronizing chain
      if (sendTransaction) {
        console.log('Archipel node has some peers and is synchronized so adding heartbeats...');

        // Get keys from mnemonic
        const keys = await getKeysFromSeed(mnemonic);
        // Get account nonce
        const accountNonce = await this.api.query.system.account(keys.address);
        const nonce = accountNonce.nonce;
        // Nonce show
        debug('addHeartbeat', `Nonce: ${nonce} groupId ${groupId} mode ${mode} nodeStatus ${nodeStatus}`);

        // create, sign and send transaction
        return new Promise((resolve, reject) => {
          this.api.tx.archipelModule
          // Create transaction
            .addHeartbeat(groupId, nodeStatus)
          // Sign transaction
            .sign(keys, { nonce })
          // Send transaction
            .send(({ events = [], status }) => {
            // Debug show transaction status
              this.transactionShowStatus(status, 'addHeartbeat');
              if (status.isFinalized) {
                events.forEach(async ({ event: { data, method, section } }) => {
                  if (section.toString() === 'archipelModule' && method.toString() === 'NewHeartbeat') {
                  // Show transaction data for Debug
                    debug('addHeartbeat', 'Transaction was successfully sent and generated an event.');
                    debug('addHeartbeat', `JSON Data: [${JSON.parse(data.toString())}]`);
                    resolve(true);
                  }
                });
                resolve(false);
              }
              // If transaction is not ok resolving promise to false
              if (status.isDropped || status.isInvalid || status.isUsurped) {
                resolve(false);
              }
            }).catch(err => reject(err));
        });
      } else {
        console.log('Archipel node can\'t receive transactions...');
        return false;
      }
    } catch (error) {
      debug('addHeartbeat', error);
      throw error;
    }
  }

  // Get current leader from Runtime
  async getLeader (groupId) {
    try {
      return await this.api.query.archipelModule.leaders(groupId);
    } catch (error) {
      debug('getLeader', error);
      return false;
    }
  };

  // Get leadedGroup status from Runtime
  async isLeadedGroup (groupId) {
    try {
      return JSON.parse(await this.api.query.archipelModule.leadedGroup(groupId));
    } catch (error) {
      debug('isLeadedGroup', error);
      return false;
    }
  };

  // Get heartbeat from Runtime
  async getHeartbeat (key) {
    try {
      return await this.api.query.archipelModule.heartbeats(key);
    } catch (error) {
      debug('getHeartbeat', error);
      console.log(error);
      return false;
    }
  }

  // Get Node Status from Runtime
  async getNodeStatus (key) {
    try {
      return parseInt(await this.api.query.archipelModule.nodesStatus(key));
    } catch (error) {
      debug('getNodeStatus', error);
      console.log(error);
      return 0;
    }
  }

  // Get bestNumber Chain
  async getBestNumber () {
    try {
      const bestNumber = await this.api.derive.chain.bestNumber();
      return bestNumber;
    } catch (error) {
      debug('getBestNumber', error);
      return 0;
    }
  }

  // Get peer number connected to Archipel node
  async getPeerNumber () {
    try {
      const health = await this.api.rpc.system.health();
      return parseInt(health.peers);
    } catch (error) {
      debug('getPeerNumber', error);
      return 0;
    }
  }

  // Get node sync state. Gives true if node is synching
  async getSyncState () {
    try {
      const health = await this.api.rpc.system.health();
      return health.isSyncing.toString() === 'true';
    } catch (error) {
      debug('getSyncState', error);
      return 0;
    }
  }

  // Set leader
  async setLeader (oldLeader, groupId, mnemonic) {
    try {
      // Get keys from mnemonic
      const keys = await getKeysFromSeed(mnemonic);

      // Get account nonce
      const accountNonce = await this.api.query.system.account(keys.address);
      const nonce = accountNonce.nonce;

      // Nonce show
      debug('setLeader', `Nonce: ${nonce}`);

      return new Promise((resolve, reject) => {
        // create, sign and send transaction
        this.api.tx.archipelModule
          // create transaction
          .setLeader(oldLeader, groupId)
          // Sign and transaction
          .sign(keys, { nonce })
          // Send transaction
          .send(({ events = [], status }) => {
            // Debug show transaction status
            this.transactionShowStatus(status, 'setLeader');
            if (status.isFinalized) {
              events.forEach(async ({ event: { data, method, section } }) => {
                if (section.toString() === 'archipelModule' && method.toString() === 'NewLeader') {
                  // Show transaction data for Debug
                  console.log('Transaction was successfully sent and generated an event.');
                  console.log(`JSON Data: [${JSON.parse(data.toString())}]`);
                  resolve(true);
                }
              });
              resolve(false);
            }
            // If transaction is not ok resolving promise to false
            if (status.isDropped || status.isInvalid || status.isUsurped) {
              resolve(false);
            }
          }).catch(err => reject(err));
      });
    } catch (error) {
      debug('setLeader', error);
      throw error;
    }
  }

  // Give Up Leadership
  async giveUpLeadership (groupId, mnemonic) {
    try {
      // Get keys from mnemonic
      const keys = await getKeysFromSeed(mnemonic);

      // Get account nonce
      const accountNonce = await this.api.query.system.account(keys.address);
      const nonce = accountNonce.nonce;

      // Nonce show
      debug('giveUpLeadership', `Nonce: ${nonce}`);

      return new Promise((resolve, reject) => {
        // create, sign and send transaction
        this.api.tx.archipelModule
          // create transaction
          .giveUpLeadership(groupId)
          // Sign and transaction
          .sign(keys, { nonce })
          // Send transaction
          .send(({ events = [], status }) => {
            // Debug show transaction status
            this.transactionShowStatus(status, 'giveUpLeadership');
            if (status.isFinalized) {
              events.forEach(async ({ event: { data, method, section } }) => {
                if (section.toString() === 'archipelModule' && method.toString() === 'GiveUpLeader') {
                  // Show transaction data for Debug
                  console.log('Transaction was successfully sent and generated an event.');
                  console.log(`JSON Data: [${JSON.parse(data.toString())}]`);
                  resolve(true);
                }
              });
              resolve(false);
            }
            // If transaction is not ok resolving promise to false
            if (status.isDropped || status.isInvalid || status.isUsurped) {
              resolve(false);
            }
          }).catch(err => reject(err));
      });
    } catch (error) {
      debug('giveUpLeadership', error);
      throw error;
    }
  }

  // Get peer id from chain
  async getPeeId () {
    try {
      const networkState = await this.api.rpc.system.networkState();
      return networkState.peerId.toString();
    } catch (error) {
      debug('getPeeId', error);
      throw error;
    }
  }

  // Check if connected to node
  isConnected () {
    try {
      return this.provider.isConnected.toString() !== 'false';
    } catch (error) {
      debug('isConnected', error);
      throw error;
    }
  }

  // Disconnect from chain
  async disconnect () {
    if (this.api) {
      this.api.disconnect();
    }
  }
}

module.exports = {
  Chain
};

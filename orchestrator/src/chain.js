const { ApiPromise, WsProvider } = require('@polkadot/api');
const debug = require('debug')('chain');

const { getKeysFromSeed } = require('./utils');

class Chain {
  constructor (wsProvider, role) {
    this.wsProvider = wsProvider;
    this.metricSendEnabled = true;
    this.metricSendEnabledAdmin = true;
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
  async listenEvents (metrics, orchestrator, mnemonic) {
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
          // Add metrics if Metrics updated event was received
          if (event.section.toString() === 'archipelModule' && event.method.toString() === 'MetricsUpdated') {
            debug('listenEvents', `Received metrics updated event from ${event.data[0].toString()}`);
            metrics.addMetrics(event.data[0].toString(), event.data[1].toString(), event.data[2].toString());
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
      debug('addMetrics', `Node has ${peersNumber} peers.`);

      // Get sync state
      let syncState = await this.getSyncState();
      debug('addMetrics', `Node is sync: ${syncState}`);

      if (peersNumber === 0 || syncState === true) {
        console.log('peersNumber is 0 or synch in progress. Wait 5 sec and retry');
        console.log('peersNumber :' + peersNumber);
        console.log('syncState :' + syncState);
        await new Promise(resolve => setTimeout(resolve, 5000));
        peersNumber = await this.getPeerNumber();
        syncState = await this.getSyncState();
        console.log('new peersNumber :' + peersNumber);
        console.log('new syncState :' + syncState);
      }

      // If node has any peers and is not in synchronizing chain
      return peersNumber !== 0 && syncState !== true;
    } catch (error) {
      debug('canSendTransactions', error);
      throw error;
    }
  }

  // Send metrics
  async addMetrics (metrics, mnemonic) {
    try {
      // Checking if metrics send is enabled
      console.log('Checking if metrics send is enabled...');
      if (!this.metricSendEnabled || !this.metricSendEnabledAdmin) {
        console.log('Metrics send is disabled...');
        return;
      }

      // If node state permits to send transactions
      const sendTransaction = await this.canSendTransactions();

      // If node has any peers and is not in synchronizing chain
      if (sendTransaction) {
        console.log('Archipel node has some peers and is synchronized so adding metrics...');

        // Get keys from mnemonic
        const keys = await getKeysFromSeed(mnemonic);
        // Get account nonce
        const accountNonce = await this.api.query.system.account(keys.address);
        const nonce = accountNonce.nonce;
        // Nonce show
        debug('addMetrics', `Nonce: ${nonce}`);

        // create, sign and send transaction
        return new Promise((resolve, reject) => {
          this.api.tx.archipelModule
          // Create transaction
            .addMetrics(metrics)
          // Sign transaction
            .sign(keys, { nonce })
          // Send transaction
            .send(({ events = [], status }) => {
            // Debug show transaction status
              this.transactionShowStatus(status, 'addMetrics');
              if (status.isFinalized) {
                events.forEach(async ({ event: { data, method, section } }) => {
                  if (section.toString() === 'archipelModule' && method.toString() === 'MetricsUpdated') {
                  // Show transaction data for Debug
                    debug('addMetrics', 'Transaction was successfully sent and generated an event.');
                    debug('addMetrics', `JSON Data: [${JSON.parse(data.toString())}]`);
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
      debug('addMetrics', error);
      throw error;
    }
  }

  // Get current leader from Runtime
  async getLeader () {
    try {
      return await this.api.query.archipelModule.leader();
    } catch (error) {
      debug('getLeader', error);
      return false;
    }
  };

  // Get metrics from Runtime
  async getMetrics (key) {
    try {
      return await this.api.query.archipelModule.metrics(key);
    } catch (error) {
      debug('getMetrics', error);
      console.log(error);
      return false;
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
  async setLeader (oldLeader, mnemonic) {
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
          .setLeader(oldLeader)
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
      return this.provider.isConnected().toString() !== 'false';
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

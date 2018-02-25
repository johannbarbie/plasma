/* global assert */

import utils from 'ethereumjs-util'

import assertRevert from './helpers/assertRevert'
import {mineToBlockHeight} from './helpers/utils'
import {generateFirstWallets} from './helpers/wallets'

// import chain components
import Transaction from '../src/chain/transaction'
import FixedMerkleTree from '../src/lib/fixed-merkle-tree'

// require root chain
let RootChain = artifacts.require('./RootChain.sol')

const BN = utils.BN
const rlp = utils.rlp

// generate first 5 wallets
const mnemonics =
  'clock radar mass judge dismiss just intact mind resemble fringe diary casino'
const wallets = generateFirstWallets(mnemonics, 5)

const getDepositTx = (owner, value) => {
  return new Transaction([
    new Buffer([]), // block number 1
    new Buffer([]), // tx number 1
    new Buffer([]), // previous output number 1 (input 1)
    new Buffer([]), // block number 2
    new Buffer([]), // tx number 2
    new Buffer([]), // previous output number 2 (input 2)

    utils.toBuffer(owner), // output address 1
    value.toArrayLike(Buffer, 'be', 32), // value for output 2

    utils.zeros(20), // output address 2
    new Buffer([]), // value for output 2

    new Buffer([]) // fee
  ])
}


contract('Root chain', function(accounts) {

  describe('test for incorrect mapping key', async function() {
    const value = new BN(web3.toWei(0.05, 'ether'))

    let rootChain

    // before task
    before(async function() {
      rootChain = await RootChain.new({from: accounts[0]})
    })

    it('should not overwrite exit', async function() {

      // alice and deposit and mine
      let alice = wallets[0].getAddressString();
      let a_depositTx = getDepositTx(alice, value)
      await rootChain.deposit(utils.bufferToHex(a_depositTx.serializeTx()), { from: alice, value: value });
      let a_transferTx = new Transaction([utils.toBuffer(1), new Buffer([]), new Buffer([]), new Buffer([]), new Buffer([]), new Buffer([]),
        utils.toBuffer(alice), value.toArrayLike(Buffer, 'be', 32), utils.zeros(20), new Buffer([]), new Buffer([]) ]);
      const a_transferTxBytes = utils.bufferToHex(a_transferTx.serializeTx())
      a_transferTx.sign1(wallets[0].getPrivateKey())
      const a_merkleHash = a_transferTx.merkleHash()
      const a_tree = new FixedMerkleTree(16, [a_merkleHash])
      const a_proof = utils.bufferToHex(
        Buffer.concat(a_tree.getPlasmaProof(a_merkleHash))
      )
      await mineToBlockHeight(web3.eth.blockNumber + 7)
      await rootChain.submitBlock(utils.bufferToHex(a_tree.getRoot()))
      let [childChainRoot, t] = await rootChain.getChildChain(2)
      childChainRoot = utils.toBuffer(childChainRoot)
      const a_sigs = utils.bufferToHex(
        Buffer.concat([
          a_transferTx.sig1,
          a_transferTx.sig2,
          a_transferTx.confirmSig(childChainRoot, wallets[0].getPrivateKey())
        ])
      )

      // bob and deposit and mine
      let bob = wallets[1].getAddressString();
      let b_depositTx = getDepositTx(bob, value)
      await rootChain.deposit(utils.bufferToHex(b_depositTx.serializeTx()), { from: bob, value: value });
      let b_transferTx = new Transaction([utils.toBuffer(3), new Buffer([]), new Buffer([]), new Buffer([]), new Buffer([]), new Buffer([]),
        utils.toBuffer(bob), value.toArrayLike(Buffer, 'be', 32), utils.zeros(20), new Buffer([]), new Buffer([]) ]);
      const b_transferTxBytes = utils.bufferToHex(b_transferTx.serializeTx())
      b_transferTx.sign1(wallets[1].getPrivateKey()) // sign1
      const b_merkleHash = b_transferTx.merkleHash()
      const b_tree = new FixedMerkleTree(16, [b_merkleHash])
      const b_proof = utils.bufferToHex(
        Buffer.concat(b_tree.getPlasmaProof(b_merkleHash))
      )
      await mineToBlockHeight(web3.eth.blockNumber + 7)
      await rootChain.submitBlock(utils.bufferToHex(b_tree.getRoot()))
      let [b_childChainRoot, b_t] = await rootChain.getChildChain(4)
      b_childChainRoot = utils.toBuffer(b_childChainRoot)
      const b_sigs = utils.bufferToHex(
        Buffer.concat([
          b_transferTx.sig1,
          b_transferTx.sig2,
          b_transferTx.confirmSig(b_childChainRoot, wallets[1].getPrivateKey())
        ])
      )

      // time passes and blocks move ahead
      await rootChain.incrementWeekOldBlock();
      await rootChain.incrementWeekOldBlock();
      await rootChain.incrementWeekOldBlock();
      await rootChain.incrementWeekOldBlock();

      // alice start exit
      await rootChain.startExit([2, 0, 0], a_transferTxBytes, a_proof, a_sigs, { from: alice })
      let [user1, amount1, posResult1] = await rootChain.getExit(4000000000)
      assert.equal(user1, alice);

      // bob start exit
      await rootChain.startExit([4, 0, 0], b_transferTxBytes, b_proof, b_sigs, { from: bob })
      let [user2, amount2, posResult2] = await rootChain.getExit(4000000000)

      // the exit data of the alice (priority 4000000000) should not be overwritten
      assert.equal(user2, alice);
    })
  })
})

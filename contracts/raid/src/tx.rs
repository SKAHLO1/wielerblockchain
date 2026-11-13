//! Foreign flag-transaction builders.
//!
//! The raid contract builds every flag transaction itself from on-chain data (the epoch
//! result) plus a few foreign-chain parameters supplied by the broadcaster (nonce, fee,
//! UTXO, blockhash). Those parameters are checked against guardrails, so the MPC network
//! is only ever asked to sign a zero-value / dust self-transfer that carries the memo.

use near_sdk::env;

// ---------------------------------------------------------------- helpers

pub fn dsha256(data: &[u8]) -> [u8; 32] {
    env::sha256_array(&env::sha256_array(data))
}

pub fn hash160(data: &[u8]) -> [u8; 20] {
    env::ripemd160_array(&env::sha256_array(data))
}

fn strip_leading_zeros(b: &[u8]) -> &[u8] {
    let mut i = 0;
    while i < b.len() && b[i] == 0 {
        i += 1;
    }
    &b[i..]
}

fn be_bytes_u128(v: u128) -> Vec<u8> {
    strip_leading_zeros(&v.to_be_bytes()).to_vec()
}

// ---------------------------------------------------------------- RLP

fn rlp_len_prefix(len: usize, short: u8, long: u8) -> Vec<u8> {
    if len <= 55 {
        vec![short + len as u8]
    } else {
        let l = be_bytes_u128(len as u128);
        let mut out = vec![long + l.len() as u8];
        out.extend_from_slice(&l);
        out
    }
}

pub fn rlp_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        return b.to_vec();
    }
    let mut out = rlp_len_prefix(b.len(), 0x80, 0xb7);
    out.extend_from_slice(b);
    out
}

pub fn rlp_uint(v: u128) -> Vec<u8> {
    rlp_bytes(&be_bytes_u128(v))
}

pub fn rlp_list(items: &[Vec<u8>]) -> Vec<u8> {
    let payload: Vec<u8> = items.concat();
    let mut out = rlp_len_prefix(payload.len(), 0xc0, 0xf7);
    out.extend_from_slice(&payload);
    out
}

// ---------------------------------------------------------------- EVM (EIP-1559)

pub struct EvmTx {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub gas_limit: u64,
    pub to: [u8; 20],
    pub data: Vec<u8>,
}

impl EvmTx {
    fn fields(&self) -> Vec<Vec<u8>> {
        vec![
            rlp_uint(self.chain_id as u128),
            rlp_uint(self.nonce as u128),
            rlp_uint(self.max_priority_fee_per_gas),
            rlp_uint(self.max_fee_per_gas),
            rlp_uint(self.gas_limit as u128),
            rlp_bytes(&self.to),
            rlp_uint(0), // value: always zero
            rlp_bytes(&self.data),
            rlp_list(&[]), // empty access list
        ]
    }

    pub fn unsigned(&self) -> Vec<u8> {
        let mut out = vec![0x02];
        out.extend(rlp_list(&self.fields()));
        out
    }

    pub fn signing_hash(&self) -> [u8; 32] {
        env::keccak256_array(&self.unsigned())
    }

    pub fn signed(&self, r: &[u8; 32], s: &[u8; 32], y_parity: u8) -> Vec<u8> {
        let mut f = self.fields();
        f.push(rlp_uint(y_parity as u128));
        f.push(rlp_bytes(strip_leading_zeros(r)));
        f.push(rlp_bytes(strip_leading_zeros(s)));
        let mut out = vec![0x02];
        out.extend(rlp_list(&f));
        out
    }
}

pub fn evm_min_gas(data: &[u8]) -> u64 {
    21_000 + data.iter().map(|b| if *b == 0 { 4u64 } else { 16u64 }).sum::<u64>()
}

// ---------------------------------------------------------------- Bitcoin (P2WPKH, one input)

pub struct BtcTx {
    /// Previous txid in internal byte order (reversed display hex).
    pub prev_txid_le: [u8; 32],
    pub vout: u32,
    pub input_value: u64,
    pub change_value: u64,
    pub pkh: [u8; 20],
    pub memo: Vec<u8>,
}

const SEQUENCE: [u8; 4] = [0xfd, 0xff, 0xff, 0xff];
const VERSION: [u8; 4] = [2, 0, 0, 0];
const LOCKTIME: [u8; 4] = [0, 0, 0, 0];

impl BtcTx {
    fn outpoint(&self) -> Vec<u8> {
        let mut o = self.prev_txid_le.to_vec();
        o.extend_from_slice(&self.vout.to_le_bytes());
        o
    }

    fn op_return_script(&self) -> Vec<u8> {
        let mut s = vec![0x6a];
        let n = self.memo.len();
        if n <= 75 {
            s.push(n as u8);
        } else {
            s.push(0x4c);
            s.push(n as u8);
        }
        s.extend_from_slice(&self.memo);
        s
    }

    fn p2wpkh_script(&self) -> Vec<u8> {
        let mut s = vec![0x00, 0x14];
        s.extend_from_slice(&self.pkh);
        s
    }

    fn outputs(&self) -> Vec<u8> {
        let mut o = Vec::new();
        let opr = self.op_return_script();
        o.extend_from_slice(&0u64.to_le_bytes());
        o.push(opr.len() as u8);
        o.extend(opr);
        let p2 = self.p2wpkh_script();
        o.extend_from_slice(&self.change_value.to_le_bytes());
        o.push(p2.len() as u8);
        o.extend(p2);
        o
    }

    /// Legacy (non-witness) serialization: its double-SHA256 is the txid.
    pub fn non_witness(&self) -> Vec<u8> {
        let mut t = VERSION.to_vec();
        t.push(1);
        t.extend(self.outpoint());
        t.push(0); // empty scriptSig
        t.extend_from_slice(&SEQUENCE);
        t.push(2);
        t.extend(self.outputs());
        t.extend_from_slice(&LOCKTIME);
        t
    }

    /// Display txid (big-endian hex order).
    pub fn txid(&self) -> [u8; 32] {
        let mut h = dsha256(&self.non_witness());
        h.reverse();
        h
    }

    /// BIP-143 sighash (SIGHASH_ALL) for the single P2WPKH input.
    pub fn sighash(&self) -> [u8; 32] {
        let hash_prevouts = dsha256(&self.outpoint());
        let hash_sequence = dsha256(&SEQUENCE);
        let hash_outputs = dsha256(&self.outputs());
        let mut p = VERSION.to_vec();
        p.extend_from_slice(&hash_prevouts);
        p.extend_from_slice(&hash_sequence);
        p.extend(self.outpoint());
        p.extend_from_slice(&[0x19, 0x76, 0xa9, 0x14]);
        p.extend_from_slice(&self.pkh);
        p.extend_from_slice(&[0x88, 0xac]);
        p.extend_from_slice(&self.input_value.to_le_bytes());
        p.extend_from_slice(&SEQUENCE);
        p.extend_from_slice(&hash_outputs);
        p.extend_from_slice(&LOCKTIME);
        p.extend_from_slice(&1u32.to_le_bytes());
        dsha256(&p)
    }

    pub fn signed(&self, r: &[u8; 32], s: &[u8; 32], pubkey: &[u8]) -> Vec<u8> {
        let mut sig = der_signature(r, s);
        sig.push(0x01); // SIGHASH_ALL
        let mut t = VERSION.to_vec();
        t.extend_from_slice(&[0x00, 0x01]); // segwit marker + flag
        t.push(1);
        t.extend(self.outpoint());
        t.push(0);
        t.extend_from_slice(&SEQUENCE);
        t.push(2);
        t.extend(self.outputs());
        t.push(2); // witness items
        t.push(sig.len() as u8);
        t.extend(sig);
        t.push(pubkey.len() as u8);
        t.extend_from_slice(pubkey);
        t.extend_from_slice(&LOCKTIME);
        t
    }
}

fn der_int(v: &[u8; 32]) -> Vec<u8> {
    let mut b = strip_leading_zeros(v).to_vec();
    if b.is_empty() {
        b.push(0);
    }
    if b[0] & 0x80 != 0 {
        b.insert(0, 0);
    }
    let mut out = vec![0x02, b.len() as u8];
    out.extend(b);
    out
}

pub fn der_signature(r: &[u8; 32], s: &[u8; 32]) -> Vec<u8> {
    let ri = der_int(r);
    let si = der_int(s);
    let mut out = vec![0x30, (ri.len() + si.len()) as u8];
    out.extend(ri);
    out.extend(si);
    out
}

/// Encodes a P2WPKH bech32 address ("tb" for testnet).
pub fn p2wpkh_address(hrp: &str, pkh: &[u8; 20]) -> String {
    const CHARSET: &[u8] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    fn polymod(values: &[u8]) -> u32 {
        const GEN: [u32; 5] = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
        let mut chk: u32 = 1;
        for v in values {
            let b = chk >> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ (*v as u32);
            for (i, g) in GEN.iter().enumerate() {
                if (b >> i) & 1 == 1 {
                    chk ^= g;
                }
            }
        }
        chk
    }
    // 8-bit -> 5-bit
    let mut data = vec![0u8]; // witness version 0
    let mut acc: u32 = 0;
    let mut bits = 0;
    for b in pkh {
        acc = (acc << 8) | *b as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            data.push(((acc >> bits) & 31) as u8);
        }
    }
    if bits > 0 {
        data.push(((acc << (5 - bits)) & 31) as u8);
    }
    let mut values: Vec<u8> = hrp.bytes().map(|c| c >> 5).collect();
    values.push(0);
    values.extend(hrp.bytes().map(|c| c & 31));
    values.extend(&data);
    values.extend([0u8; 6]);
    let pm = polymod(&values) ^ 1;
    let mut out = String::from(hrp);
    out.push('1');
    for d in &data {
        out.push(CHARSET[*d as usize] as char);
    }
    for i in 0..6 {
        out.push(CHARSET[((pm >> (5 * (5 - i))) & 31) as usize] as char);
    }
    out
}

// ---------------------------------------------------------------- Solana (Memo program)

pub const MEMO_PROGRAM: &str = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

fn compact_u16(mut v: usize) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let mut byte = (v & 0x7f) as u8;
        v >>= 7;
        if v != 0 {
            byte |= 0x80;
            out.push(byte);
        } else {
            out.push(byte);
            break;
        }
    }
    out
}

/// Legacy Solana message: fee payer = the derived WIELER wallet, one Memo instruction.
pub fn solana_message(payer: &[u8; 32], recent_blockhash: &[u8; 32], memo: &[u8]) -> Vec<u8> {
    let memo_program: Vec<u8> = bs58::decode(MEMO_PROGRAM).into_vec().expect("memo id");
    let mut m = vec![1u8, 0, 1]; // 1 signer, 0 ro-signed, 1 ro-unsigned (memo program)
    m.extend(compact_u16(2));
    m.extend_from_slice(payer);
    m.extend_from_slice(&memo_program);
    m.extend_from_slice(recent_blockhash);
    m.extend(compact_u16(1)); // one instruction
    m.push(1); // program id index
    m.extend(compact_u16(0)); // no accounts
    m.extend(compact_u16(memo.len()));
    m.extend_from_slice(memo);
    m
}

pub fn solana_signed(message: &[u8], sig: &[u8; 64]) -> Vec<u8> {
    let mut t = compact_u16(1);
    t.extend_from_slice(sig);
    t.extend_from_slice(message);
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rlp_basics() {
        assert_eq!(rlp_uint(0), vec![0x80]);
        assert_eq!(rlp_uint(15), vec![0x0f]);
        assert_eq!(rlp_uint(1024), vec![0x82, 0x04, 0x00]);
        assert_eq!(rlp_bytes(b"dog"), vec![0x83, b'd', b'o', b'g']);
        assert_eq!(rlp_list(&[]), vec![0xc0]);
    }

    #[test]
    fn bech32_known_vector() {
        // BIP-173 test vector: hash160 751e76e8199196d454941c45d1b3a323f1433bd6
        let pkh: [u8; 20] = hex::decode("751e76e8199196d454941c45d1b3a323f1433bd6")
            .unwrap()
            .try_into()
            .unwrap();
        assert_eq!(p2wpkh_address("bc", &pkh), "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
        assert_eq!(p2wpkh_address("tb", &pkh), "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx");
    }

    #[test]
    fn der_adds_padding() {
        let mut r = [0u8; 32];
        r[0] = 0x80;
        let s = [1u8; 32];
        let d = der_signature(&r, &s);
        assert_eq!(d[0], 0x30);
        assert_eq!(d[2], 0x02);
        assert_eq!(d[3], 33);
        assert_eq!(d[4], 0);
    }
}

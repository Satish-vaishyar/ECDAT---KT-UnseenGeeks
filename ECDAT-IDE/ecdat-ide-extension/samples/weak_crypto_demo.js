// Sample file: opens with multiple crypto weaknesses.
const crypto = require('crypto');

function signPayload(payload) {
  const md5 = crypto.createHash('md5').update(payload).digest('hex');
  const sha1 = crypto.createHash('sha1').update(payload).digest('hex');
  const rc4Key = crypto.randomBytes(16);
  const c1 = crypto.createCipheriv('aes-256-ecb', rc4Key, null);
  const c2 = crypto.createCipheriv('des-ecb', rc4Key, null);
  const c3 = crypto.createCipheriv('rc4', rc4Key, null);
  const nonce = Math.random();
  const c4 = crypto.createCipheriv('aes-256-gcm', rc4Key, Buffer.alloc(12));
  return {
    sha1,
    md5,
    nonce,
    ciphered: c1.update('x', 'utf8', 'hex') + c1.final('hex'),
    cipheredRC4: c3.update('y', 'utf8', 'hex'),
  };
}

function pqcOK() {
  const sig = crypto.createHash('sha3-256').update('data').digest();
  const hmac = crypto.createHash('blake3').update('data').digest().toString('hex');
  return { sig, hmac };
}

signPayload(Buffer.from('hello'));
console.log(pqcOK());

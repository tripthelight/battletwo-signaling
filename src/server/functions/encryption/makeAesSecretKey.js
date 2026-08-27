import crypto from 'crypto';

export default () => {
  const secretKey = crypto.randomBytes(32);
  const base64Key = secretKey.toString('base64');
  const hexKey = secretKey.toString('hex');
  return base64Key;
};

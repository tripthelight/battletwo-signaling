/**
 * 원문 데이터를 복호화해서 다시 얻고 싶다면 → bcrypto의 AES 사용 → npm install bcrypto
 * 사용자 비밀번호 등은 비교만 하면 되고, 복호화는 필요 없다면 → bcryptjs or bcrypt 사용 → npm install bcryptjs
 */
import bcrypt from 'bcryptjs';

/**
 * 문자열 암호화 함수
 * @param {string} _param
 * @returns {Promise<string>} 해시된 문자열
 */
async function encryption(_param) {
  const saltRounds = 3;
  const salt = await bcrypt.genSalt(saltRounds);
  return await bcrypt.hash(_param, salt);
}

/**
 * 문자열 복호화 함수
 * @param {string} _decryptStr 비교 대상
 * @param {string} _encryptStr 암호화된 문자
 * @returns {boolean} 암호화된 문자와 비교대상이 일치하면 true
 */
async function decryption(_decryptStr, _encryptStr) {
  const match = await bcrypt.compare(_encryptStr, _decryptStr);
  if (match) {
    return true;
  }
  return false;
}

export const ENCRYPTION_STORAGE = {
  encryption,
  decryption,
};

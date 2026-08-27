/**
 * 현재 시간 정보를 기반으로 128bit 길이(16자리)의 영문 대문자 문자열을 생성
 * AES-128 키로 사용 가능
 */
export default () => {
  const salt = `${Date.now()}${performance.now()}`;
  let hash = 0;
  for (let i = 0; i < salt.length; i++) {
    hash = (hash << 5) - hash + salt.charCodeAt(i);
    hash |= 0;
  }

  const seed = Math.abs(hash);
  const A_CODE = 'A'.charCodeAt(0);
  let result = '';
  let current = seed;

  for (let i = 0; i < 16; i++) {
    current = (current * 31 + i) % 26;
    result += String.fromCharCode(A_CODE + current);
  }

  return result; // 예: 'QWERTYUIOPASDFGH'
};

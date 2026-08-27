/**
 * 현재 시, 분, 초 정보를 salt로 활용하여 매 시분초마다 달라지는 10자리 영문 대문자 문자열을 반환
 */
export default () => {
  // const now = new Date();
  // const salt = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}${now.getMilliseconds()}`; // 밀리초까지 추가
  const salt = `${Date.now()}${performance.now()}`; // 소수점 포함 밀리초 (≈μs)
  let hash = 0;
  for (let i = 0; i < salt.length; i++) {
    hash = (hash << 5) - hash + salt.charCodeAt(i);
    hash |= 0;
  }
  const seed = Math.abs(hash);
  const A_CODE = 'A'.charCodeAt(0);
  let result = '';
  let current = seed;
  for (let i = 0; i < 10; i++) {
    current = (current * 31 + i) % 26;
    result += String.fromCharCode(A_CODE + current);
  }
  // return 'ABHMMNTYYZ';
  return result;
};

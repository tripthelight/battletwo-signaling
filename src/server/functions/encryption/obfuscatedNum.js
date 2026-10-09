const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CODE_LENGTH = 10;
const NUM_COUNT = 20;

function createObfuscatedNumbers() {
  const letters = [...ALPHABET];
  const used = new Set();
  const numL = Object.create(null);
  const numR = Object.create(null);

  function createUniqueCode() {
    let code;

    do {
      code = '';

      for (let i = 0; i < CODE_LENGTH; i++) {
        const index = i + Math.floor(Math.random() * (letters.length - i));
        const selected = letters[index];

        letters[index] = letters[i];
        letters[i] = selected;

        code += selected;
      }
    } while (used.has(code));

    used.add(code);
    return code;
  }

  for (let i = 0; i < NUM_COUNT; i++) {
    const key = `NUM_${i}`;
    numL[key] = createUniqueCode();
    numR[key] = createUniqueCode();
  }

  return {
    numL, // numR과 중복되지 않은 value를 가진 10자리 난독화 문자열 20 set
    numR  // numL과 중복되지 않은 value를 가진 10자리 난독화 문자열 20 set
  };
}

export const { numL, numR } = createObfuscatedNumbers();

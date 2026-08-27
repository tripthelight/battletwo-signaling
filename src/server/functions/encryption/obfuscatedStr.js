import matchKeys from "./matchKeys.js";

// ------------------------------
// 내부 유틸들
// ------------------------------
function xs32(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    return x >>> 0;
  };
};

function xorStreamInPlace(u8, seed) {
  const next = xs32(seed);
  for (let i = 0; i < u8.length; i++) {
    const r = next();
    // 기존 코드와 같은 느낌의 키 생성(인덱스 섞기 + 바이트 선택)
    const k = ((r ^ Math.imul(i, 0x9e3779b9)) >>> ((i & 3) << 3)) & 0xff;
    u8[i] ^= k;
  }
  return u8;
};

function u8ToB64(u8) {
  // 브라우저 우선
  if (typeof btoa === "function") {
    let bin = "";
    // 큰 데이터도 버티도록 chunk 처리
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
      const part = u8.subarray(i, i + CH);
      bin += String.fromCharCode(...part);
    }
    return btoa(bin);
  }
  // Node.js
  return Buffer.from(u8).toString("base64");
};

function splitAndScramble(b64, pieces) {
  const n = Math.max(2, pieces | 0);
  const len = b64.length;

  // 길이를 n등분하되, 앞쪽이 1글자씩 더 가지도록 분배
  const base = (len / n) | 0;
  const extra = len - base * n;

  const out = new Array(n);
  let pos = 0;

  for (let i = 0; i < n; i++) {
    const take = base + (i < extra ? 1 : 0);
    let chunk = b64.slice(pos, pos + take);
    pos += take;

    // 홀수 인덱스는 뒤집기
    if (i & 1) chunk = chunk.split("").reverse().join("");

    out[i] = chunk;
  }
  return out;
};

// ------------------------------
// 난독화(P) 생성기
// ------------------------------
function makeP({
  // keysByRow: 길이 10, 각 원소는 길이 10의 [a,b,c] 배열들
  // 즉 총 100개의 3-튜플 키
  keysByRow,
  // outs: 길이 10, 각 원소는 길이 10의 결과 숫자 배열
  // 질문에 적어주신 10개 배열이 여기에 들어갑니다.
  outs,
  // 출력 P 조각 개수(기본 14)
  pieces = 14,
  // seed (복호화쪽과 맞춰야 함)
  seed = 0xa5f1523d,
} = {}) {
  // ---- 유효성 최소 검사 (코드 복잡도는 유지하면서도 안전)
  if (!Array.isArray(keysByRow) || keysByRow.length !== 10) {
    throw new Error("keysByRow는 길이 10이어야 합니다.");
  }
  if (!Array.isArray(outs) || outs.length !== 10) {
    throw new Error("outs는 길이 10이어야 합니다.");
  }

  const REC = 16; // [u16,u16,u16] + [10 bytes]
  const totalRecs = 10 * 10;
  const raw = new Uint8Array(totalRecs * REC);
  const dv = new DataView(raw.buffer);

  // ---- (A) 직렬화: 100 레코드 채우기
  // row r (0..9): keysByRow[r][c] 중 하나를 받으면 outs[r]를 리턴해야 하므로
  // 각 row마다 10개의 키를 동일 output과 함께 저장
  let recIndex = 0;

  for (let r = 0; r < 10; r++) {
    const rowKeys = keysByRow[r];
    const outArr = outs[r];

    if (!Array.isArray(rowKeys) || rowKeys.length !== 10) {
      throw new Error(`keysByRow[${r}]는 길이 10이어야 합니다.`);
    }
    if (!Array.isArray(outArr) || outArr.length !== 10) {
      throw new Error(`outs[${r}]는 길이 10이어야 합니다.`);
    }

    for (let c = 0; c < 10; c++) {
      const key = rowKeys[c];
      if (!Array.isArray(key) || key.length !== 3) {
        throw new Error(`keysByRow[${r}][${c}]는 [a,b,c]여야 합니다.`);
      }

      const a = key[0] | 0;
      const b = key[1] | 0;
      const cc = key[2] | 0;

      const off = recIndex * REC;

      // u16LE 3개 (0..65535 범위를 벗어나면 하위 16비트만 저장됨)
      dv.setUint16(off + 0, a & 0xffff, true);
      dv.setUint16(off + 2, b & 0xffff, true);
      dv.setUint16(off + 4, cc & 0xffff, true);

      // output 10 bytes (0..255 가정. 아니면 하위 8비트만 저장)
      for (let i = 0; i < 10; i++) {
        raw[off + 6 + i] = outArr[i] & 0xff;
      }

      recIndex++;
    }
  }

  // ---- (B) 스트림 XOR (암/복호화 동일)
  xorStreamInPlace(raw, seed);

  // ---- (C) Base64 인코딩
  const b64 = u8ToB64(raw);

  // ---- (D) 조각내기 + 홀수 인덱스 뒤집기
  const P = splitAndScramble(b64, pieces);

  return P;
}

function randomStrSeed(n) {
  const LOWER = "abcdefghijklmnopqrstuvwxyz";
  const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const SPECIAL = "!@#$%^&*?/+-_~()[]{}<>.,:;|\\";
  const CHARSET = LOWER + UPPER + SPECIAL;

  // 1~5자리 랜덤 문자열 생성
  function randChunk(minLen = 1, maxLen = 5) {
    const len = randInt(minLen, maxLen);
    return Array.from({ length: len }, () => CHARSET[randInt(0, CHARSET.length - 1)]).join("");
  }

  // 안전한 랜덤 정수 (가능하면 crypto 사용)
  function randInt(min, max) {
    const range = max - min + 1;
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return min + (buf[0] % range);
    }
    return min + Math.floor(Math.random() * range);
  }

  const digits = String(n).split("");
  const body = digits.reduce((acc, d) => acc + d + randChunk(), randChunk()); // 시작 + (숫자+사이/끝)
  return body + "==";
};

export default function () {
  /**
   * 인덱스(...idxs)를 인자로 받아 matchKeys에서 해당 요소들만 뽑아 새 배열로 만드는 코드
   * @param {Array<Array<number>>} idxs matchKeys 배열에서 빼내올 index 배열 모음
   * @returns {Array<Array<number>>} matchKeys에서 인자로 받은 index에 해당하는 배열 모음
   */
  function pickFromArrByList(idxs) {
    return idxs.map((i) => matchKeys[i]);
  };

  const seed = (Math.random() * 0x100000000) >>> 0;
  const arr = makeP({
    keysByRow: pickFromArrByList([0,1,2,3,4,5,6,7,8,9]), // 0~9에 해당하는 3개묶음 배열들은 public card nums에서 사용
    outs: [
      [79, 69, 74, 78, 73, 72, 77, 75, 88, 84], // NUM 1
      [71, 73, 90, 70, 78, 80, 84, 83, 86, 75], // NUM 2
      [79, 67, 78, 76, 84, 71, 77, 70, 75, 83], // NUM 3
      [68, 75, 72, 79, 88, 77, 73, 86, 69, 65], // NUM 4
      [80, 68, 66, 73, 90, 85, 79, 70, 77, 74], // NUM 5
      [75, 70, 79, 85, 68, 66, 82, 90, 86, 73], // NUM 6
      [77, 73, 80, 71, 83, 72, 68, 65, 85, 70], // NUM 7
      [83, 74, 82, 87, 84, 68, 71, 85, 88, 72], // NUM 8
      [72, 74, 90, 85, 84, 79, 88, 70, 81, 65], // NUM 9
      [74, 82, 80, 70, 73, 71, 83, 66, 68, 78]  // NUM 10
    ],
    // pieces: 14, // P 조각 수
    pieces: Math.floor(Math.random() * (15 - 10 + 1)) + 10, // P 조각 수: 10 ~ 15중 래덤
    // seed: 0xa5f1523d, // decode쪽 seed와 동일해야 함
    seed, // decode쪽 seed와 동일해야 함
  }); // 배열 내 마지막 문자 빼고 나머지 문자들의 마지막에 "==" 추가

  // 배열 내 마지막 문자 빼고 나머지 문자들의 마지막에 "==" 추가
  const equalArr = arr.map((v, i) => (i === arr.length - 1 ? v : v + "=="));

  const randomSeed = randomStrSeed(seed);

  // 배열의 마지막에 seed 추가
  equalArr.push(randomSeed);

  // 랜덤한 문자열이 뒤섰인 seed를 원래 숫자로 복원
  // console.log(randomSeed.replace(/==$/, "").replace(/\D/g, ""));

  return equalArr;
};

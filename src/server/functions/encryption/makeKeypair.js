export default async function () {
  const { default: CRC32 } = await import('crc-32');
  return (CRC32.str(Math.random().toString(36).substring(2, 10)) >>> 0).toString(16);
};

import { parseType } from './starkabi.js';
import type { AbiParameter, StarknetStruct, StarknetType, StarknetCoreType } from './types.js';
import type { BigNumber } from '@0x/utils';

export function decodeFromTypes(
  types: StarknetType[],
  values: BigNumber[]
): any[] {
  let offset = 0;
  const results: any[] = [];

  for (const type of types) {
    const [value, newOffset] = decodeCoreType(type, values, offset);
    results.push(value);
    offset = newOffset;
  }

  return results;
}

export function decodeFromParams(
  params: AbiParameter[],
  values: BigNumber[],
  structs: Map<string, StarknetStruct> = new Map()
): Record<string, any> {
  let offset = 0;
  const result: Record<string, any> = {};

  for (const param of params) {
    const [value, newOffset] = decodeCoreType(param.type, values, offset, structs);
    result[param.name ?? 'data'] = value;
    offset = newOffset;
  }

  return result;
}

// WARN: This is a mess and should be re-worked
export function decodeCoreType(
  type: StarknetType,
  values: BigNumber[],
  offset: number,
  structs: Map<string, StarknetStruct> = new Map()
): [any, number] {
  if (typeof type === 'object' && type.type === 'struct') {
    const structDef = structs.get(type.name);
    if (!structDef) throw new Error(`Undefined struct: ${type.name}`);

    const result: Record<string, any> = {};
    for (const member of structDef.members) {
      // Parse the member type string to StarknetType
      const parsedType = parseType(member.type as string);
      const [value, newOffset] = decodeCoreType(
        parsedType,
        values,
        offset,
        structs
      );
      result[member.name] = value;
      offset = newOffset;
    }
    return [result, offset];
  }

  if (isArrayType(type)) {
    const length = Number(values[offset]) || 0;
    const array: any[] = [];
    let currentOffset = offset + 1;

    for (let i = 0; i < length; i++) {
      const [value, newOffset] = decodeCoreType(type.elementType, values, currentOffset);
      array.push(value);
      currentOffset = newOffset;
    }

    return [array, currentOffset];
  }

  switch (type) {
    case 'bool':
    case 'core::bool':
      if (!values[offset]) {
        throw new Error('Invalid Bool value');
      }
      return [values[offset]?.toNumber() !== 0, offset + 1];
    case 'u8':
    case 'core::integer::u8':
    case 'i8':
    case 'core::integer::i8':
    case 'u16':
    case 'core::integer::u16':
    case 'i16':
    case 'core::integer::i16':
    case 'u32':
    case 'core::integer::u32':
    case 'i32':
    case 'core::integer::i32':
      if (!values[offset]) {
        throw new Error(`Invalid ${type} value`);
      }
      return [values[offset]?.toNumber() || 0, offset + 1];
    case 'u64':
    case 'core::integer::u64':
    case 'i64':
    case 'core::integer::i64':
    case 'u128':
    case 'core::integer::u128':
    case 'i128':
    case 'core::integer::i128':
      if (!values[offset]) {
        throw new Error(`Invalid ${type} value`);
      }
      return [BigInt(values[offset]?.toString() || '0'), offset + 1];
    case 'u256':
    case 'core::integer::u256':
    case 'uint256':
      if (!values[offset] || !values[offset + 1]) {
        throw new Error('Invalid U256 value');
      }
      return [
        BigInt(values[offset]?.toString() || '0') + (BigInt(values[offset + 1]?.toString() || '0') << 128n),
        offset + 2
      ];
    case 'felt':
    case 'core::felt252': {
      if (!values[offset]) {
        throw new Error('Invalid Felt value');
      }
      const feltValue = BigInt(values[offset]?.toString() || '0');

      // Check if this looks like a ByteArray instead of ShortString
      const possibleDataLen = Number(feltValue);
      if (possibleDataLen <= 10 && values.length >= offset + 3) {
        // Check if the pattern looks like ByteArray: small dataLen, followed by pending_word_len < 32
        const possiblePendingWordLen = Number(values[offset + 2 + possibleDataLen]?.toString() || '0');

        if (possiblePendingWordLen > 0 && possiblePendingWordLen <= 31) {
          // probably ByteArray?
          const dataLen = possibleDataLen;
          let currentOffset = offset + 1;
          const dataChunks: bigint[] = [];
          for (let i = 0; i < dataLen; i++) {
            if (values[currentOffset]) {
              dataChunks.push(BigInt(values[currentOffset]?.toString() || '0'));
            }
            currentOffset++;
          }

          const pendingWord = BigInt(values[currentOffset]?.toString() || '0');
          currentOffset++;
          const pendingWordLen = possiblePendingWordLen;
          currentOffset++;

          const hexString = byteArrayToHex(dataChunks, pendingWord, pendingWordLen);
          return [hexString, currentOffset];
        }
      }
      return [`0x${feltValue.toString(16)}`, offset + 1];
    }
    case 'contract_address':
    case 'core::starknet::contract_address::ContractAddress':
      if (!values[offset]) {
        throw new Error('Invalid Contract Address value');
      }
      return [`0x${BigInt(values[offset]?.toString() || '0').toString(16)}`, offset + 1];
    case 'bytes31':
    case 'core::bytes_31::bytes31':
      // bytes31 is a single felt252 containing up to 31 bytes
      if (!values[offset]) {
        throw new Error('Invalid bytes31 value');
      }
      return [BigInt(values[offset]?.toString() || '0'), offset + 1];
    case 'ByteArray':
    case 'core::byte_array::ByteArray': {
      // ByteArray layout: [data_len, ...data (bytes31[]), pending_word, pending_word_len]
      if (!values[offset]) {
        throw new Error('Invalid ByteArray: missing data_len');
      }

      const firstValue = BigInt(values[offset]?.toString() || '0');
      const dataLen = Number(firstValue);

      // Check if this looks like a short string instead of ByteArray
      if (dataLen > 1000 || !Number.isFinite(dataLen)) {
        // Return as hex felt252
        return [`0x${firstValue.toString(16)}`, offset + 1];
      }

      const expectedLength = offset + 1 + dataLen + 2;
      if (values.length < expectedLength) {
        return [`0x${firstValue.toString(16)}`, offset + 1];
      }

      let currentOffset = offset + 1;

      const dataChunks: bigint[] = [];
      for (let i = 0; i < dataLen; i++) {
        if (!values[currentOffset]) {
          // Fallback for no values, something is wrong i think
          return [`0x${firstValue.toString(16)}`, offset + 1];
        }
        dataChunks.push(BigInt(values[currentOffset]?.toString() || '0'));
        currentOffset++;
      }

      // Get pending_word and pending_word_len
      if (!values[currentOffset]) return [`0x${firstValue.toString(16)}`, offset + 1];
      const pendingWord = BigInt(values[currentOffset]?.toString() || '0');
      currentOffset++;

      if (!values[currentOffset]) return [`0x${firstValue.toString(16)}`, offset + 1];
      const pendingWordLen = Number(values[currentOffset]?.toString() || '0');
      currentOffset++;

      // Convert ByteArray to hex string (concatenated bytes)
      const hexString = byteArrayToHex(dataChunks, pendingWord, pendingWordLen);
      return [hexString, currentOffset];
    }
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
}

function isArrayType(type: StarknetType): type is { type: 'array', elementType: StarknetCoreType } {
  return typeof type === 'object' && 'type' in type && type.type === 'array';
}

/**
 * Convert a ByteArray to hex string
 */
function byteArrayToHex(
  dataChunks: bigint[],
  pendingWord: bigint,
  pendingWordLen: number
): string {
  const bytes: number[] = [];
  for (const chunk of dataChunks) {
    const chunkBytes = bigintToBytes(chunk, 31);
    bytes.push(...chunkBytes);
  }
  if (pendingWordLen > 0) {
    const pendingBytes = bigintToBytes(pendingWord, pendingWordLen);
    bytes.push(...pendingBytes);
  }

  // Convert bytes to hex string
  return `0x${bytes.map(b => b.toString(16).padStart(2, '0')).join('')}`
}

/** 
 * Convert a bigint to a byte array of specified length (big-endian) 
 */
function bigintToBytes(value: bigint, length: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  for (let i = 0; i < length; i++) {
    bytes.unshift(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  return bytes;
}

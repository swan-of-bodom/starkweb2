import type {
  AbiParameter,
  StarknetAbiEvent,
  StarknetAbiFunction,
  StarknetAbiInterface,
  StarknetCoreType,
  StarknetEnum,
  StarknetStruct,
  StarknetType,
} from "./types.js";

export function parseStarknetAbi<const T extends readonly any[]>(abi: T): {
  functions: ReadonlyArray<StarknetAbiFunction<T[number]['name']>>,
  events: ReadonlyArray<StarknetAbiEvent>,
  implementedInterfaces: ReadonlyArray<StarknetAbiInterface>,
  structs: ReadonlyArray<StarknetStruct>,
  enums: ReadonlyArray<StarknetEnum>
} {
  const functions: StarknetAbiFunction<T[number]['name']>[] = [];
  const events: StarknetAbiEvent[] = [];
  const interfaces: StarknetAbiInterface[] = [];
  const structs: StarknetStruct[] = [];
  const enums: StarknetEnum[] = [];

  for (const item of abi) {
    const abiItem = item as any;
    switch (abiItem.type) {
      case 'function':
        functions.push({
          type: 'function',
          name: abiItem.name,
          inputs: abiItem.inputs?.map(parseAbiParameter) || [],
          outputs: abiItem.outputs?.map(parseAbiParameter) || []
        });
        break;
      case 'event':
        events.push({
          type: 'event',
          name: abiItem.name,
          inputs: abiItem.inputs?.map(parseAbiParameter) || [],
          kind: 'enum',
          variants: []
        });
        break;
      case 'interface': {
        // Parse functions from interface to ensure inputs/outputs are properly typed
        const interfaceFunctions = abiItem.items
          .filter((i: any) => i.type === 'function')
          .map((f: any) => ({
            type: 'function' as const,
            name: f.name,
            inputs: f.inputs?.map(parseAbiParameter) || [],
            outputs: f.outputs?.map(parseAbiParameter) || []
          }));
        functions.push(...interfaceFunctions);

        const interfaceEvents = abiItem.items
          .filter((i: any) => i.type === 'event')
          .map((e: any) => ({
            type: 'event' as const,
            name: e.name,
            inputs: e.inputs?.map(parseAbiParameter) || [],
            kind: 'enum' as const,
            variants: []
          }));
        events.push(...interfaceEvents);

        interfaces.push({
          name: abiItem.name,
          items: abiItem.items?.map(parseAbiParameter) || []
        });
        break;
      }
      case 'struct':
        structs.push({
          type: 'struct',
          name: abiItem.name,
          members: abiItem.members?.map(parseAbiParameter) || []
        });
        break;
      case 'enum':
        enums.push({
          type: 'enum',
          name: abiItem.name,
          variants: abiItem.variants?.map(parseAbiParameter) || []
        });
        break;
    }
  }
  return {
    functions: functions as ReadonlyArray<StarknetAbiFunction<T[number]['name']>>,
    events: events as ReadonlyArray<StarknetAbiEvent>,
    implementedInterfaces: interfaces as ReadonlyArray<StarknetAbiInterface>,
    structs: structs as ReadonlyArray<StarknetStruct>,
    enums: enums as ReadonlyArray<StarknetEnum>
  };
}

function parseAbiParameter(param: unknown): AbiParameter {
  const p = param as { name: string; type: string };
  return {
    name: p.name,
    type: parseType(p.type)
  };
}


export function parseType(typeStr: string | StarknetType): StarknetType {
    // If already a parsed type object, return it
    if (typeof typeStr === 'object') {
      return typeStr;
    }

    // Handle core::array::Array::<T> syntax
    if (typeStr.startsWith('core::array::Array::<')) {
      const elementType = typeStr
        .replace('core::array::Array::<', '')
        .replace('>', '');
      return {
        type: 'array',
        elementType: parseType(elementType) as StarknetCoreType
      };
    }

    // Existing array handling
    if (typeStr.endsWith('*')) {
      const baseType = typeStr.slice(0, -1);
      return {
        type: 'array',
        elementType: parseBaseType(baseType)
      };
    }

    // Check if it's a known primitive type (even with core:: prefix)
    const primitiveTypes = [
      'bool', 'core::bool',
      'felt', 'felt252', 'core::felt252',
      'u8', 'core::integer::u8',
      'u16', 'core::integer::u16',
      'u32', 'core::integer::u32',
      'u64', 'core::integer::u64',
      'u128', 'core::integer::u128',
      'u256', 'core::integer::u256', 'uint256',
      'contract_address', 'core::starknet::contract_address::ContractAddress'
    ];

    if (primitiveTypes.includes(typeStr)) {
      return parseBaseType(typeStr);
    }

    // Handle struct references (types with :: that aren't primitives)
    if (typeStr.includes('::')) {
      return { type: 'struct', name: typeStr, members: [] };
    }

    return parseBaseType(typeStr);
  }

function parseBaseType(typeStr: string): StarknetCoreType {
  return typeStr as StarknetCoreType;
}


export type ContractFunctionName<T> = T extends { 
  functions: ReadonlyArray<StarknetAbiFunction<infer N>> 
} ? N : never;
// import { testAbi } from "./testabi.js";
// const abinew2 = parseStarknetAbi(testAbi);
// type exp2 = ContractFunctionName<typeof abinew2>;

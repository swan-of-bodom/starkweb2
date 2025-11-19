import { parseStarknetAbi } from "./starkabi.js";
import { decodeFromParams } from "./decode.js";
import { BigNumber } from "@0x/utils";
import type { StarknetStruct } from "./types.js";

export function decodeFunctionCall(result: string[], functionName: string, abi: any[]) {
    const newAbi = parseStarknetAbi(abi);
    const functionCall = newAbi.functions.find((f) => f.name === functionName);
    if (!functionCall) {
        throw new Error(`Function ${functionName} not found in ABI`);
    }
    const outputParams = functionCall.outputs;

    // Build structs map from ABI
    const structsMap = new Map<string, StarknetStruct>();
    for (const struct of newAbi.structs) {
        structsMap.set(struct.name, struct);
    }

    // Convert string[] to BigNumber[]
    const bigNumberValues = result.map(r => new BigNumber(r));

    return decodeFromParams(outputParams, bigNumberValues, structsMap);
}
> [!WARNING]  
> This has only been tested for use of starknet-ponder and should not be used in production.


# Starkweb2

Fork of [starkweb](https://github.com/NethermindEth/starkweb) adding support for starknet-ponder indexer.

## Changes from starkweb

- Support for signed integer types (i8, i16, i32, i64, i128)
- Support for all Starknet integer types (u8, u16, u32, u64, u128)
- Improved struct and type parsing in decoder
- Fixed u256/u512 output types

## Installation

```bash
npm install starkweb2
```

## Usage

Same API as starkweb - see https://github.com/NethermindEth/starkweb.

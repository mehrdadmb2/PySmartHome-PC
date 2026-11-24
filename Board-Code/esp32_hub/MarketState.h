#pragma once
#include <stdint.h>

// Shared compact market state. Kept in a header because Arduino's .ino
// preprocessor may emit function prototypes before structs defined in the sketch.
struct MarketState {
  uint64_t dollarToman;
  uint64_t gold18KToman;
  bool dollarValid;
  bool goldValid;
  bool dollarSourceStale;
  bool goldSourceStale;
  uint32_t lastSuccessAt;
  int lastHttpCode;
  char lastError[48];
  char updatedAt[28];
};

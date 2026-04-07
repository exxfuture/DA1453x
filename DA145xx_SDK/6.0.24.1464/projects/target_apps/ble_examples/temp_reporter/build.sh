#!/bin/bash

# Temperature Reporter Build Script for DA14531
# This script cleans previous builds and builds the project to generate the output binary

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project paths
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ECLIPSE_DIR="${PROJECT_ROOT}/Eclipse"
BUILD_DIR="${ECLIPSE_DIR}/DA14531"

# Ensure we're in the project root directory
cd "$PROJECT_ROOT"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  DA14531 Temperature Reporter Build   ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if build directory exists
if [ ! -d "$BUILD_DIR" ]; then
    echo -e "${RED}Error: Build directory not found: $BUILD_DIR${NC}"
    exit 1
fi

# Change to build directory
cd "$BUILD_DIR"

echo -e "${YELLOW}Cleaning previous build artifacts...${NC}"

# Clean previous build
if [ -d "$BUILD_DIR" ]; then
    (cd "$BUILD_DIR" && make clean)
else
    echo "Build directory not found: $BUILD_DIR"
    exit 1
fi

# Remove any remaining build artifacts
rm -f temp_reporter.elf temp_reporter.hex temp_reporter.map temp_reporter.siz
rm -f *.o *.d
find . -name "*.o" -delete
find . -name "*.d" -delete

echo -e "${GREEN}Clean completed.${NC}"
echo ""

echo -e "${YELLOW}Starting build process...${NC}"

# Build the project
if (cd "$BUILD_DIR" && make all -j$(nproc 2>/dev/null || echo 4)); then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}         BUILD SUCCESSFUL!             ${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    
    # Check if output files were generated
    if [ -f "$BUILD_DIR/temp_reporter.elf" ]; then
        echo -e "${GREEN}✓ ELF file generated: $BUILD_DIR/temp_reporter.elf${NC}"

        # Get file size
        ELF_SIZE=$(ls -lh "$BUILD_DIR/temp_reporter.elf" | awk '{print $5}')
        echo -e "${BLUE}  Size: $ELF_SIZE${NC}"
    else
        echo -e "${RED}✗ ELF file not found!${NC}"
        exit 1
    fi

    if [ -f "$BUILD_DIR/temp_reporter.hex" ]; then
        echo -e "${GREEN}✓ HEX file generated: $BUILD_DIR/temp_reporter.hex${NC}"

        # Get file size
        HEX_SIZE=$(ls -lh "$BUILD_DIR/temp_reporter.hex" | awk '{print $5}')
        echo -e "${BLUE}  Size: $HEX_SIZE${NC}"
    else
        echo -e "${RED}✗ HEX file not found!${NC}"
        exit 1
    fi
    
    if [ -f "temp_reporter.map" ]; then
        echo -e "${GREEN}✓ MAP file generated: temp_reporter.map${NC}"
    fi
    
    echo ""
    echo -e "${GREEN}Output files location: $BUILD_DIR${NC}"
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Build completed successfully!        ${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo -e "1. Flash temp_reporter.hex to your DA14531 device"
    echo -e "2. The device will advertise as 'DLG_TEMPR'"
    echo -e "3. Connect with a BLE scanner to see temperature measurements"
    echo -e "4. Use a BLE client to configure measurement interval via GATT"
    echo ""
    
else
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}           BUILD FAILED!               ${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo -e "${RED}Build process encountered errors. Please check the output above.${NC}"
    exit 1
fi

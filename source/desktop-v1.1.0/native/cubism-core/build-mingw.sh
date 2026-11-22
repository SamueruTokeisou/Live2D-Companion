#!/usr/bin/env bash
# 用 MinGW 构建 cubism_core.node（本机没有 Windows SDK，MSVC 走不通）
set -e
cd "$(dirname "$0")"

MSYS=/c/msys64/ucrt64/bin
GXX="$MSYS/g++.exe"
OBJDUMP="$MSYS/objdump.exe"
DLLTOOL="$MSYS/dlltool.exe"
INC="C:/Users/33153/AppData/Local/node-gyp/Cache/24.16.0/include/node"
ELECTRON="D:/WebCodingRepo/live2d-stage/node_modules/electron/dist/electron.exe"

mkdir -p build
cd build

# 1) 从 electron.exe 提取 napi 导出，生成最小导入库
if [ ! -f libnapi.a ]; then
  "$OBJDUMP" -p "$ELECTRON" \
    | grep -E '(napi_|node_api_|node_module_register)' \
    | awk '{print $NF}' \
    | grep -E '^(napi_|node_api_|node_module_register)' | sort -u > napi-syms.txt
  { echo "LIBRARY electron.exe"; echo "EXPORTS"; cat napi-syms.txt; } > napi.def
  "$DLLTOOL" -k -d napi.def -l libnapi.a
  echo "导入库生成：$(wc -l < napi-syms.txt) 个符号"
fi

# 2) 编译
"$GXX" -c -O2 -std=c++17 -DNAPI_VERSION=8 -DNODE_GYP_MODULE_NAME=cubism_core \
  -D_CRT_SECURE_NO_WARNINGS \
  -I"$INC" ../cubism_core.cc -o cubism_core.o

# 3) 链接
"$GXX" -shared -static-libgcc -static-libstdc++ -o cubism_core.node cubism_core.o \
  -L. -lnapi -lkernel32

echo "OK: $(ls -la cubism_core.node)"

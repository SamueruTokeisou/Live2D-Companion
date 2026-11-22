// Cubism Core 原生桥：把官方 Live2DCubismCore.dll 包成 N-API 模块。
// 设计原则：
//   1. 每帧只跨一次边界（update），其余数据全部预分配成 JS 侧 ArrayBuffer；
//   2. 参数读写完全在 JS 侧做（不走原生），省掉原 WASM 版本每帧几百次 get/setParameter；
//   3. C API 全部用 GetProcAddress 动态取，不依赖 .lib，DLL 路径可运行时指定。

#define NAPI_VERSION 8
#include <node_api.h>

#include <windows.h>

#include <cstdint>
#include <cstdlib>
#include <cstring>

#ifdef _MSC_VER
#include <malloc.h>
#endif
#include <string>
#include <vector>

// ---- N-API 符号运行期解析 ----
// 编译期链接会把导入模块名写死成宿主 exe 的名字（开发时 electron.exe），
// 而打包版主程序被改名成「大肥鱼Live2d桌宠.exe」，导入表就找不到模块了。
// 所以这里不链接 napi_*，改为启动时从宿主进程的导出表里取。
#define CSM_NAPI_FUNCS(X)                             \
  X(napi_create_array_with_length)                    \
  X(napi_create_arraybuffer)                          \
  X(napi_create_double)                               \
  X(napi_create_external)                             \
  X(napi_create_int32)                                \
  X(napi_create_object)                               \
  X(napi_create_reference)                            \
  X(napi_create_string_utf8)                          \
  X(napi_create_typedarray)                           \
  X(napi_create_uint32)                               \
  X(napi_define_properties)                           \
  X(napi_delete_reference)                            \
  X(napi_get_arraybuffer_info)                        \
  X(napi_get_boolean)                                 \
  X(napi_get_cb_info)                                 \
  X(napi_get_typedarray_info)                         \
  X(napi_get_undefined)                               \
  X(napi_get_value_external)                          \
  X(napi_get_value_string_utf8)                       \
  X(napi_get_value_uint32)                            \
  X(napi_is_arraybuffer)                              \
  X(napi_is_typedarray)                               \
  X(napi_set_element)                                 \
  X(napi_set_named_property)                          \
  X(napi_typeof)

#define CSM_DECL(name) static decltype(&::name) p_##name = nullptr;
CSM_NAPI_FUNCS(CSM_DECL)
#undef CSM_DECL

static bool ResolveNapi() {
  HMODULE host = ::GetModuleHandleW(nullptr);
  if (!host) return false;
  bool ok = true;
#define CSM_LOAD(name)                                                  \
  p_##name = reinterpret_cast<decltype(p_##name)>(                      \
      reinterpret_cast<void*>(::GetProcAddress(host, #name)));          \
  if (!p_##name) ok = false;
  CSM_NAPI_FUNCS(CSM_LOAD)
#undef CSM_LOAD
  return ok;
}

#define napi_create_array_with_length p_napi_create_array_with_length
#define napi_create_arraybuffer p_napi_create_arraybuffer
#define napi_create_double p_napi_create_double
#define napi_create_external p_napi_create_external
#define napi_create_int32 p_napi_create_int32
#define napi_create_object p_napi_create_object
#define napi_create_reference p_napi_create_reference
#define napi_create_string_utf8 p_napi_create_string_utf8
#define napi_create_typedarray p_napi_create_typedarray
#define napi_create_uint32 p_napi_create_uint32
#define napi_define_properties p_napi_define_properties
#define napi_delete_reference p_napi_delete_reference
#define napi_get_arraybuffer_info p_napi_get_arraybuffer_info
#define napi_get_boolean p_napi_get_boolean
#define napi_get_cb_info p_napi_get_cb_info
#define napi_get_typedarray_info p_napi_get_typedarray_info
#define napi_get_undefined p_napi_get_undefined
#define napi_get_value_external p_napi_get_value_external
#define napi_get_value_string_utf8 p_napi_get_value_string_utf8
#define napi_get_value_uint32 p_napi_get_value_uint32
#define napi_is_arraybuffer p_napi_is_arraybuffer
#define napi_is_typedarray p_napi_is_typedarray
#define napi_set_element p_napi_set_element
#define napi_set_named_property p_napi_set_named_property
#define napi_typeof p_napi_typeof

// ---- 最小化声明（不引入 SDK 头文件，避免 dllimport 干扰）----
struct csmMoc;
struct csmModel;
typedef void (*csmLogFunction)(const char* message);

#define FN_LIST(X)                                                              \
  X(unsigned int, csmGetVersion, ())                                            \
  X(int, csmGetLatestMocVersion, ())                                            \
  X(int, csmGetMocVersion, (const void*, const unsigned int))                    \
  X(int, csmHasMocConsistency, (void*, const unsigned int))                      \
  X(void, csmSetLogFunction, (csmLogFunction))                                  \
  X(csmLogFunction, csmGetLogFunction, ())                                      \
  X(csmMoc*, csmReviveMocInPlace, (void*, unsigned int))                        \
  X(unsigned int, csmGetSizeofModel, (const csmMoc*))                           \
  X(csmModel*, csmInitializeModelInPlace,                                       \
    (const csmMoc*, void*, unsigned int))                                       \
  X(void, csmUpdateModel, (csmModel*))                                          \
  X(void, csmResetDrawableDynamicFlags, (csmModel*))                            \
  X(void, csmReadCanvasInfo, (const csmModel*, float*, float*, float*))         \
  X(int, csmGetParameterCount, (const csmModel*))                               \
  X(const char**, csmGetParameterIds, (const csmModel*))                        \
  X(const float*, csmGetParameterMinimumValues, (const csmModel*))              \
  X(const float*, csmGetParameterMaximumValues, (const csmModel*))              \
  X(const float*, csmGetParameterDefaultValues, (const csmModel*))              \
  X(float*, csmGetParameterValues, (const csmModel*))                           \
  X(const int*, csmGetParameterTypes, (const csmModel*))                        \
  X(const int*, csmGetParameterRepeats, (const csmModel*))                      \
  X(const int*, csmGetParameterKeyCounts, (const csmModel*))                    \
  X(const float**, csmGetParameterKeyValues, (const csmModel*))                 \
  X(int, csmGetPartCount, (const csmModel*))                                    \
  X(const char**, csmGetPartIds, (const csmModel*))                             \
  X(const float*, csmGetPartOpacities, (const csmModel*))                       \
  X(const int*, csmGetPartParentPartIndices, (const csmModel*))                 \
  X(int, csmGetDrawableCount, (const csmModel*))                                \
  X(const char**, csmGetDrawableIds, (const csmModel*))                         \
  X(const unsigned char*, csmGetDrawableConstantFlags, (const csmModel*))       \
  X(unsigned char*, csmGetDrawableDynamicFlags, (const csmModel*))              \
  X(const int*, csmGetDrawableTextureIndices, (const csmModel*))                \
  X(const int*, csmGetDrawableDrawOrders, (const csmModel*))                    \
  X(int*, csmGetRenderOrders, (const csmModel*))                                \
  X(const float*, csmGetDrawableOpacities, (const csmModel*))                   \
  X(const int*, csmGetDrawableMaskCounts, (const csmModel*))                    \
  X(const int**, csmGetDrawableMasks, (const csmModel*))                        \
  X(const int*, csmGetDrawableVertexCounts, (const csmModel*))                  \
  X(const int*, csmGetDrawableIndexCounts, (const csmModel*))                   \
  X(const float**, csmGetDrawableVertexPositions, (const csmModel*))            \
  X(const float**, csmGetDrawableVertexUvs, (const csmModel*))                  \
  X(const unsigned short**, csmGetDrawableIndices, (const csmModel*))           \
  X(const float*, csmGetDrawableMultiplyColors, (const csmModel*))              \
  X(const float*, csmGetDrawableScreenColors, (const csmModel*))                \
  X(const int*, csmGetDrawableParentPartIndices, (const csmModel*))

struct CoreApi {
  bool loaded = false;
  HMODULE dll = nullptr;
#define DECL(ret, name, args) ret(*name) args = nullptr;
  FN_LIST(DECL)
#undef DECL
};

static CoreApi g_api;

static bool LoadCore(const char* path) {
  if (g_api.loaded) return true;
  // 必须用宽字符版：打包目录常含中文（大肥鱼…），LoadLibraryA 会找不到文件
  wchar_t wpath[MAX_PATH * 2] = {0};
  if (::MultiByteToWideChar(CP_UTF8, 0, path, -1, wpath, (int)(sizeof(wpath) / sizeof(wpath[0]))) == 0)
    return false;
  HMODULE h = ::LoadLibraryW(wpath);
  if (!h) return false;
  bool ok = true;
#define LOAD(ret, name, args)                                            \
  g_api.name = reinterpret_cast<decltype(g_api.name)>(                  \
      reinterpret_cast<void*>(::GetProcAddress(h, #name)));             \
  if (!g_api.name) ok = false;
  FN_LIST(LOAD)
#undef LOAD
  if (!ok) {
    ::FreeLibrary(h);
    return false;
  }
  g_api.dll = h;
  g_api.loaded = true;
  return true;
}

// ---------------- 句柄 ----------------
struct MocHandle {
  void* buffer = nullptr;  // 64 字节对齐的 moc 副本
  size_t size = 0;
  csmMoc* moc = nullptr;
  bool consistent = false;
};

struct ModelHandle {
  csmModel* model = nullptr;
  void* mem = nullptr;
  napi_ref moc_ref = nullptr;

  int drawableCount = 0;
  int partCount = 0;
  int paramCount = 0;

  // 静态块（顶点 UV / 索引 / 遮罩）在创建时一次填好
  std::vector<int> posOff, uvOff, idxOff, maskOff;
  // 每帧动态块的 JS 目标指针
  float* jsPos = nullptr;      // 长度 = posOff.back()
  float* jsOpacity = nullptr;  // drawableCount
  uint8_t* jsFlags = nullptr;  // drawableCount
  int32_t* jsOrder = nullptr;  // drawableCount
  float* jsMultiply = nullptr; // 4 * drawableCount
  float* jsScreen = nullptr;   // 4 * drawableCount
  float* jsParamValues = nullptr;  // paramCount
};

static void FreeMoc(napi_env, void* data, void*) {
  auto* h = static_cast<MocHandle*>(data);
  if (h) {
    if (h->buffer) _aligned_free(h->buffer);
    delete h;
  }
}

static void FreeModel(napi_env env, void* data, void*) {
  auto* h = static_cast<ModelHandle*>(data);
  if (h) {
    if (h->moc_ref) napi_delete_reference(env, h->moc_ref);
    if (h->mem) _aligned_free(h->mem);
    delete h;
  }
}

// ---------------- 工具 ----------------
static napi_value Undefined(napi_env env) {
  napi_value v;
  napi_get_undefined(env, &v);
  return v;
}

static void SetObj(napi_env env, napi_value obj, const char* key,
                   napi_value val) {
  napi_set_named_property(env, obj, key, val);
}

// 取一块可读写内存：既支持 ArrayBuffer，也支持 Float32Array 等 TypedArray。
// （引擎传进来的是 parameters.values 这个 Float32Array，早先只认 ArrayBuffer，
//  导致参数一份都没送进原生，模型永远按默认值求值 —— 角色因此完全不动。）
static bool GetBytes(napi_env env, napi_value value, void** data, size_t* len,
                     napi_typedarray_type want = napi_float32_array) {
  napi_valuetype t;
  if (napi_typeof(env, value, &t) != napi_ok) return false;
  if (t == napi_object) {
    bool isArrayBuffer = false;
    if (napi_is_arraybuffer(env, value, &isArrayBuffer) == napi_ok && isArrayBuffer) {
      return napi_get_arraybuffer_info(env, value, data, len) == napi_ok;
    }
    bool isTypedArray = false;
    if (napi_is_typedarray(env, value, &isTypedArray) == napi_ok && isTypedArray) {
      napi_typedarray_type type;
      size_t length = 0;
      void* raw = nullptr;
      napi_value ab;
      size_t offset = 0;
      if (napi_get_typedarray_info(env, value, &type, &length, &raw, &ab, &offset) != napi_ok) return false;
      if (type != want) return false;
      *data = raw;
      *len = length * (want == napi_float32_array ? 4 : (want == napi_uint16_array ? 2 : 1));
      return true;
    }
  }
  return false;
}

static napi_value MakeStringArray(napi_env env, const char** arr, int n) {
  napi_value out;
  napi_create_array_with_length(env, n, &out);
  for (int i = 0; i < n; i++) {
    napi_value s;
    napi_create_string_utf8(env, arr[i] ? arr[i] : "", NAPI_AUTO_LENGTH, &s);
    napi_set_element(env, out, i, s);
  }
  return out;
}

// 复制一份原生数据到新的 JS ArrayBuffer，返回对应 TypedArray
enum class Elem { F32, I32, U8, U16 };

static napi_value MakeCopiedArray(napi_env env, const void* src, size_t bytes,
                                  Elem elem) {
  napi_value ab;
  void* data = nullptr;
  napi_create_arraybuffer(env, bytes, &data, &ab);
  if (src && bytes) std::memcpy(data, src, bytes);
  napi_value ta;
  napi_typedarray_type t = napi_float32_array;
  if (elem == Elem::I32) t = napi_int32_array;
  if (elem == Elem::U8) t = napi_uint8_array;
  if (elem == Elem::U16) t = napi_uint16_array;
  napi_create_typedarray(env, t, bytes / (elem == Elem::F32 || elem == Elem::I32 ? 4 : (elem == Elem::U16 ? 2 : 1)), ab, 0, &ta);
  return ta;
}

// 分配一个可被原生写入的 JS ArrayBuffer，返回 {typedArray, dataPtr}
static napi_value MakeWritableArray(napi_env env, size_t count, Elem elem,
                                    void** outPtr) {
  size_t esz = (elem == Elem::F32 || elem == Elem::I32) ? 4
               : (elem == Elem::U16) ? 2 : 1;
  napi_value ab;
  void* data = nullptr;
  napi_create_arraybuffer(env, count * esz, &data, &ab);
  napi_value ta;
  napi_typedarray_type t = napi_float32_array;
  if (elem == Elem::I32) t = napi_int32_array;
  if (elem == Elem::U8) t = napi_uint8_array;
  if (elem == Elem::U16) t = napi_uint16_array;
  napi_create_typedarray(env, t, count, ab, 0, &ta);
  *outPtr = data;
  return ta;
}

static ModelHandle* GetModel(napi_env env, napi_value v) {
  void* p = nullptr;
  if (napi_get_value_external(env, v, &p) != napi_ok) return nullptr;
  return static_cast<ModelHandle*>(p);
}

static MocHandle* GetMoc(napi_env env, napi_value v) {
  void* p = nullptr;
  if (napi_get_value_external(env, v, &p) != napi_ok) return nullptr;
  return static_cast<MocHandle*>(p);
}

// ---------------- 导出函数 ----------------
static napi_value Load(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  char path[MAX_PATH * 2] = {0};
  size_t len = 0;
  if (argc < 1 || napi_get_value_string_utf8(env, args[0], path, sizeof(path), &len) != napi_ok)
    return Undefined(env);
  if (!LoadCore(path)) return Undefined(env);
  napi_value out, v;
  napi_create_object(env, &out);
  unsigned int ver = g_api.csmGetVersion();
  napi_create_uint32(env, ver, &v);
  SetObj(env, out, "version", v);
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%02u.%02u.%04u",
                (ver >> 24) & 0xff, (ver >> 16) & 0xff, ver & 0xffff);
  napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &v);
  SetObj(env, out, "versionString", v);
  napi_create_int32(env, (int32_t)g_api.csmGetLatestMocVersion(), &v);
  SetObj(env, out, "latestMocVersion", v);
  return out;
}

static napi_value GetVersionString(napi_env env, napi_callback_info) {
  napi_value v;
  napi_create_uint32(env, g_api.loaded ? g_api.csmGetVersion() : 0, &v);
  return v;
}

static napi_value GetLatestMocVersion(napi_env env, napi_callback_info) {
  napi_value v;
  napi_create_int32(env, g_api.loaded ? g_api.csmGetLatestMocVersion() : 0, &v);
  return v;
}

static napi_value GetMocVersion(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  void* data = nullptr;
  size_t len = 0;
  int result = 0;
  if (argc >= 2 && napi_get_arraybuffer_info(env, args[0], &data, &len) == napi_ok) {
    uint32_t size = 0;
    napi_get_value_uint32(env, args[1], &size);
    result = g_api.csmGetMocVersion(data, size ? size : (uint32_t)len);
  }
  napi_value v;
  napi_create_int32(env, result, &v);
  return v;
}

static napi_value HasMocConsistency(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  void* data = nullptr;
  size_t len = 0;
  bool ok = false;
  if (argc >= 1 && napi_get_arraybuffer_info(env, args[0], &data, &len) == napi_ok) {
    uint32_t size = 0;
    if (argc >= 2) napi_get_value_uint32(env, args[1], &size);
    // 注意：csmHasMocConsistency 会改写传入缓冲区，所以先拷一份对齐副本
    size_t n = size ? size : len;
    void* tmp = _aligned_malloc(n, 64);
    if (tmp) {
      std::memcpy(tmp, data, n);
      ok = g_api.csmHasMocConsistency(tmp, (unsigned int)n) != 0;
      _aligned_free(tmp);
    }
  }
  napi_value v;
  napi_get_boolean(env, ok, &v);
  return v;
}

static napi_value CreateMoc(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  void* data = nullptr;
  size_t len = 0;
  if (argc < 1 || napi_get_arraybuffer_info(env, args[0], &data, &len) != napi_ok)
    return Undefined(env);

  auto* h = new MocHandle();
  h->buffer = _aligned_malloc(len, 64);
  if (!h->buffer) {
    delete h;
    return Undefined(env);
  }
  std::memcpy(h->buffer, data, len);
  h->size = len;
  // 一致性检查必须在 revive 之前、对独立副本做（会临时改写缓冲区）
  {
    void* tmp = _aligned_malloc(len, 64);
    if (tmp) {
      std::memcpy(tmp, data, len);
      h->consistent = g_api.csmHasMocConsistency(tmp, (unsigned int)len) != 0;
      _aligned_free(tmp);
    }
  }
  h->moc = g_api.csmReviveMocInPlace(h->buffer, (unsigned int)len);
  if (!h->moc) {
    _aligned_free(h->buffer);
    delete h;
    return Undefined(env);
  }

  napi_value ext;
  napi_create_external(env, h, FreeMoc, nullptr, &ext);
  return ext;
}

static napi_value MocIsConsistent(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  MocHandle* h = argc ? GetMoc(env, args[0]) : nullptr;
  napi_value v;
  napi_get_boolean(env, h ? h->consistent : false, &v);
  return v;
}

static napi_value CreateModel(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  MocHandle* moc = argc ? GetMoc(env, args[0]) : nullptr;
  if (!moc || !moc->moc) return Undefined(env);

  unsigned int size = g_api.csmGetSizeofModel(moc->moc);
  void* mem = _aligned_malloc(size, 16);
  if (!mem) return Undefined(env);
  csmModel* model = g_api.csmInitializeModelInPlace(moc->moc, mem, size);
  if (!model) {
    _aligned_free(mem);
    return Undefined(env);
  }

  auto* h = new ModelHandle();
  h->model = model;
  h->mem = mem;
  napi_create_reference(env, args[0], 1, &h->moc_ref);

  const int dc = g_api.csmGetDrawableCount(model);
  const int pc = g_api.csmGetPartCount(model);
  const int pcount = g_api.csmGetParameterCount(model);
  h->drawableCount = dc;
  h->partCount = pc;
  h->paramCount = pcount;

  const int* vc = g_api.csmGetDrawableVertexCounts(model);
  const int* ic = g_api.csmGetDrawableIndexCounts(model);
  const int* mkc = g_api.csmGetDrawableMaskCounts(model);

  h->posOff.resize(dc);
  h->uvOff.resize(dc);
  h->idxOff.resize(dc);
  h->maskOff.resize(dc);
  int posTotal = 0, uvTotal = 0, idxTotal = 0, maskTotal = 0;
  for (int i = 0; i < dc; i++) {
    h->posOff[i] = posTotal;
    posTotal += vc[i] * 2;
    h->uvOff[i] = uvTotal;
    uvTotal += vc[i] * 2;
    h->idxOff[i] = idxTotal;
    idxTotal += ic[i];
    h->maskOff[i] = maskTotal;
    maskTotal += mkc[i];
  }

  napi_value out;
  napi_create_object(env, &out);

  // --- 静态：ids / flags / counts / 纹理 / 顺序 / 父级 ---
  SetObj(env, out, "drawableIds", MakeStringArray(env, g_api.csmGetDrawableIds(model), dc));
  {
    napi_value v;
    napi_create_int32(env, dc, &v);
    SetObj(env, out, "drawableCount", v);
  }
  SetObj(env, out, "constantFlags",
         MakeCopiedArray(env, g_api.csmGetDrawableConstantFlags(model), dc, Elem::U8));
  SetObj(env, out, "textureIndices",
         MakeCopiedArray(env, g_api.csmGetDrawableTextureIndices(model), dc * 4, Elem::I32));
  SetObj(env, out, "drawOrders",
         MakeCopiedArray(env, g_api.csmGetDrawableDrawOrders(model), dc * 4, Elem::I32));
  SetObj(env, out, "maskCounts",
         MakeCopiedArray(env, mkc, dc * 4, Elem::I32));
  SetObj(env, out, "vertexCounts",
         MakeCopiedArray(env, vc, dc * 4, Elem::I32));
  SetObj(env, out, "indexCounts",
         MakeCopiedArray(env, ic, dc * 4, Elem::I32));
  SetObj(env, out, "parentPartIndices",
         MakeCopiedArray(env, g_api.csmGetDrawableParentPartIndices(model), dc * 4, Elem::I32));

  // --- 静态：UV / 索引 / 遮罩（每 drawable 一个 typed array）---
  {
    const float** uvs = g_api.csmGetDrawableVertexUvs(model);
    const unsigned short** indices = g_api.csmGetDrawableIndices(model);
    const int** masks = g_api.csmGetDrawableMasks(model);
    napi_value uvArr, idxArr, maskArr;
    napi_create_array_with_length(env, dc, &uvArr);
    napi_create_array_with_length(env, dc, &idxArr);
    napi_create_array_with_length(env, dc, &maskArr);
    for (int i = 0; i < dc; i++) {
      napi_value ta = MakeCopiedArray(env, uvs[i], (size_t)vc[i] * 2 * 4, Elem::F32);
      napi_set_element(env, uvArr, i, ta);
      napi_value ti = MakeCopiedArray(env, indices[i], (size_t)ic[i] * 2, Elem::U16);
      napi_set_element(env, idxArr, i, ti);
      napi_value tm = MakeCopiedArray(env, masks[i], (size_t)mkc[i] * 4, Elem::I32);
      napi_set_element(env, maskArr, i, tm);
    }
    SetObj(env, out, "vertexUvs", uvArr);
    SetObj(env, out, "indices", idxArr);
    SetObj(env, out, "masks", maskArr);
  }

  // --- 动态：可写缓冲（原生每帧直接写入）---
  {
    void* p = nullptr;
    napi_value positions = MakeWritableArray(env, (size_t)posTotal, Elem::F32, &p);
    h->jsPos = static_cast<float*>(p);
    SetObj(env, out, "positions", positions);

    napi_value opacities = MakeWritableArray(env, (size_t)dc, Elem::F32, &p);
    h->jsOpacity = static_cast<float*>(p);
    SetObj(env, out, "opacities", opacities);

    napi_value flags = MakeWritableArray(env, (size_t)dc, Elem::U8, &p);
    h->jsFlags = static_cast<uint8_t*>(p);
    SetObj(env, out, "dynamicFlags", flags);

    napi_value order = MakeWritableArray(env, (size_t)dc, Elem::I32, &p);
    h->jsOrder = static_cast<int32_t*>(p);
    SetObj(env, out, "renderOrders", order);

    napi_value mul = MakeWritableArray(env, (size_t)dc * 4, Elem::F32, &p);
    h->jsMultiply = static_cast<float*>(p);
    SetObj(env, out, "multiplyColors", mul);

    napi_value scr = MakeWritableArray(env, (size_t)dc * 4, Elem::F32, &p);
    h->jsScreen = static_cast<float*>(p);
    SetObj(env, out, "screenColors", scr);
  }

  // --- 参数 / 部件 / 画布 ---
  {
    napi_value params, v;
    napi_create_object(env, &params);
    napi_create_int32(env, pcount, &v);
    SetObj(env, params, "count", v);
    SetObj(env, params, "ids",
           MakeStringArray(env, g_api.csmGetParameterIds(model), pcount));
    SetObj(env, params, "minimumValues",
           MakeCopiedArray(env, g_api.csmGetParameterMinimumValues(model), (size_t)pcount * 4, Elem::F32));
    SetObj(env, params, "maximumValues",
           MakeCopiedArray(env, g_api.csmGetParameterMaximumValues(model), (size_t)pcount * 4, Elem::F32));
    SetObj(env, params, "defaultValues",
           MakeCopiedArray(env, g_api.csmGetParameterDefaultValues(model), (size_t)pcount * 4, Elem::F32));
    SetObj(env, params, "types",
           MakeCopiedArray(env, g_api.csmGetParameterTypes(model), (size_t)pcount * 4, Elem::I32));
    SetObj(env, params, "repeats",
           MakeCopiedArray(env, g_api.csmGetParameterRepeats(model), (size_t)pcount * 4, Elem::I32));
    SetObj(env, params, "keyCounts",
           MakeCopiedArray(env, g_api.csmGetParameterKeyCounts(model), (size_t)pcount * 4, Elem::I32));
    {
      const int* kc = g_api.csmGetParameterKeyCounts(model);
      const float** kv = g_api.csmGetParameterKeyValues(model);
      napi_value arr;
      napi_create_array_with_length(env, pcount, &arr);
      for (int i = 0; i < pcount; i++) {
        napi_value ta = MakeCopiedArray(env, kv[i], (size_t)kc[i] * 4, Elem::F32);
        napi_set_element(env, arr, i, ta);
      }
      SetObj(env, params, "keyValues", arr);
    }
    // values 是活数组：每帧由 update 从 JS 拷进原生，再由原生拷回（含 core 的钳制）
    {
      void* p = nullptr;
      napi_value values = MakeWritableArray(env, (size_t)pcount, Elem::F32, &p);
      h->jsParamValues = static_cast<float*>(p);
      std::memcpy(p, g_api.csmGetParameterValues(model), (size_t)pcount * 4);
      SetObj(env, params, "values", values);
    }
    SetObj(env, out, "parameters", params);

    napi_value parts;
    napi_create_object(env, &parts);
    napi_create_int32(env, pc, &v);
    SetObj(env, parts, "count", v);
    SetObj(env, parts, "ids", MakeStringArray(env, g_api.csmGetPartIds(model), pc));
    SetObj(env, parts, "opacities",
           MakeCopiedArray(env, g_api.csmGetPartOpacities(model), (size_t)pc * 4, Elem::F32));
    SetObj(env, parts, "parentIndices",
           MakeCopiedArray(env, g_api.csmGetPartParentPartIndices(model), (size_t)pc * 4, Elem::I32));
    SetObj(env, out, "parts", parts);

    napi_value canvas;
    napi_create_object(env, &canvas);
    float size2[2] = {0, 0}, origin[2] = {0, 0}, ppu[1] = {0};
    g_api.csmReadCanvasInfo(model, size2, origin, ppu);
    napi_value f;
    napi_create_double(env, size2[0], &f); SetObj(env, canvas, "CanvasWidth", f);
    napi_create_double(env, size2[1], &f); SetObj(env, canvas, "CanvasHeight", f);
    napi_create_double(env, origin[0], &f); SetObj(env, canvas, "CanvasOriginX", f);
    napi_create_double(env, origin[1], &f); SetObj(env, canvas, "CanvasOriginY", f);
    napi_create_double(env, ppu[0], &f); SetObj(env, canvas, "PixelsPerUnit", f);
    SetObj(env, out, "canvasinfo", canvas);
  }

  napi_value ext;
  napi_create_external(env, h, FreeModel, nullptr, &ext);
  SetObj(env, out, "handle", ext);
  return out;
}

static napi_value Update(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  ModelHandle* h = argc ? GetModel(env, args[0]) : nullptr;
  if (!h || !h->model) return Undefined(env);

  // 1) 参数写入原生
  if (argc >= 2) {
    void* data = nullptr;
    size_t len = 0;
    if (GetBytes(env, args[1], &data, &len)) {
      float* dst = g_api.csmGetParameterValues(h->model);
      size_t n = (size_t)h->paramCount * 4;
      if (len < n) n = len;
      std::memcpy(dst, data, n);
    }
  }

  // 2) 求值
  g_api.csmUpdateModel(h->model);

  // 3) 动态数据搬回 JS 缓冲
  const float** srcPos = g_api.csmGetDrawableVertexPositions(h->model);
  for (int i = 0; i < h->drawableCount; i++) {
    int n = g_api.csmGetDrawableVertexCounts(h->model)[i];
    std::memcpy(h->jsPos + h->posOff[i], srcPos[i], (size_t)n * 2 * 4);
  }
  std::memcpy(h->jsOpacity, g_api.csmGetDrawableOpacities(h->model), (size_t)h->drawableCount * 4);
  std::memcpy(h->jsFlags, g_api.csmGetDrawableDynamicFlags(h->model), (size_t)h->drawableCount);
  std::memcpy(h->jsOrder, g_api.csmGetRenderOrders(h->model), (size_t)h->drawableCount * 4);
  std::memcpy(h->jsMultiply, g_api.csmGetDrawableMultiplyColors(h->model), (size_t)h->drawableCount * 16);
  std::memcpy(h->jsScreen, g_api.csmGetDrawableScreenColors(h->model), (size_t)h->drawableCount * 16);

  // 4) core 可能钳制参数，回写 JS
  std::memcpy(h->jsParamValues, g_api.csmGetParameterValues(h->model), (size_t)h->paramCount * 4);
  return Undefined(env);
}

static napi_value SaveParameters(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  ModelHandle* h = argc ? GetModel(env, args[0]) : nullptr;
  if (!h || !h->model) return Undefined(env);
  if (argc >= 2) {
    void* data = nullptr;
    size_t len = 0;
    if (GetBytes(env, args[1], &data, &len)) {
      size_t n = (size_t)h->paramCount * 4;
      if (len < n) n = len;
      std::memcpy(g_api.csmGetParameterValues(h->model), data, n);
    }
  }
  return Undefined(env);
}

// 把原生参数值拉回 JS（loadParameters 语义：恢复保存值后同步）
static napi_value PullParameters(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  ModelHandle* h = argc ? GetModel(env, args[0]) : nullptr;
  if (!h || !h->model) return Undefined(env);
  if (argc >= 2) {
    void* data = nullptr;
    size_t len = 0;
    if (GetBytes(env, args[1], &data, &len)) {
      size_t n = (size_t)h->paramCount * 4;
      if (len < n) n = len;
      std::memcpy(data, g_api.csmGetParameterValues(h->model), n);
    }
  }
  return Undefined(env);
}

// 直接清零 JS 侧 dynamicFlags，并让 core 也重置
static napi_value ResetDynamicFlags(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  ModelHandle* h = argc ? GetModel(env, args[0]) : nullptr;
  if (!h || !h->model) return Undefined(env);
  g_api.csmResetDrawableDynamicFlags(h->model);
  // 官方语义是「重置回初始状态」（可见位保留），不是全清，所以必须回读
  std::memcpy(h->jsFlags, g_api.csmGetDrawableDynamicFlags(h->model),
              (size_t)h->drawableCount);
  return Undefined(env);
}

static napi_value Init(napi_env env, napi_value exports) {
  const napi_property_attributes attrs =
      static_cast<napi_property_attributes>(napi_enumerable | napi_writable);
  napi_property_descriptor desc[] = {
      {"load", nullptr, Load, nullptr, nullptr, nullptr, attrs, nullptr},
      {"version", nullptr, GetVersionString, nullptr, nullptr, nullptr, attrs, nullptr},
      {"latestMocVersion", nullptr, GetLatestMocVersion, nullptr, nullptr, nullptr, attrs, nullptr},
      {"mocVersion", nullptr, GetMocVersion, nullptr, nullptr, nullptr, attrs, nullptr},
      {"hasMocConsistency", nullptr, HasMocConsistency, nullptr, nullptr, nullptr, attrs, nullptr},
      {"createMoc", nullptr, CreateMoc, nullptr, nullptr, nullptr, attrs, nullptr},
      {"mocIsConsistent", nullptr, MocIsConsistent, nullptr, nullptr, nullptr, attrs, nullptr},
      {"createModel", nullptr, CreateModel, nullptr, nullptr, nullptr, attrs, nullptr},
      {"update", nullptr, Update, nullptr, nullptr, nullptr, attrs, nullptr},
      {"saveParameters", nullptr, SaveParameters, nullptr, nullptr, nullptr, attrs, nullptr},
      {"pullParameters", nullptr, PullParameters, nullptr, nullptr, nullptr, attrs, nullptr},
      {"resetDynamicFlags", nullptr, ResetDynamicFlags, nullptr, nullptr, nullptr, attrs, nullptr},
  };
  napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
  return exports;
}

// 入口：不依赖链接期的 napi 符号，先运行时解析，再交给 Init
extern "C" __declspec(dllexport) napi_value
napi_register_module_v1(napi_env env, napi_value exports) {
  if (!ResolveNapi()) return nullptr;
  return Init(env, exports);
}

extern "C" __declspec(dllexport) int node_api_module_get_api_version_v1() {
  return NAPI_VERSION;
}

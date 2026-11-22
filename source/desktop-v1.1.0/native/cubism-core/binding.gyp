{
  "targets": [
    {
      "target_name": "cubism_core",
      "sources": ["cubism_core.cc"],
      "defines": ["NAPI_VERSION=8"],
      "windows": {
        "msvs_settings": {
          "VCCLCompilerTool": {
            "AdditionalOptions": ["/std:c++17", "/EHsc"],
            "Optimization": 2,
            "ExceptionHandling": 1
          }
        }
      },
      "cflags_cc": ["-std=c++17", "-O2"]
    }
  ]
}

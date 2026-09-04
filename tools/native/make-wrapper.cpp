#include <cstdlib>
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <process.h>
#include <chrono>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

namespace {

size_t first_content(const std::string& line) {
  const size_t first = line.find_first_not_of(" \t");
  return first;
}

bool replace_all(std::string& value, const std::string& from,
                 const std::string& to) {
  if (from.empty()) {
    return false;
  }
  bool changed = false;
  size_t position = 0;
  while ((position = value.find(from, position)) != std::string::npos) {
    value.replace(position, from.size(), to);
    position += to.size();
    changed = true;
  }
  return changed;
}

bool replace_all(std::wstring& value, const std::wstring& from,
                 const std::wstring& to) {
  if (from.empty()) {
    return false;
  }
  bool changed = false;
  size_t position = 0;
  while ((position = value.find(from, position)) != std::wstring::npos) {
    value.replace(position, from.size(), to);
    position += to.size();
    changed = true;
  }
  return changed;
}

bool replace_project_root(std::string& value) {
  const wchar_t* root_value = _wgetenv(L"PROCESSOR_SKILLS_PROJECT_ROOT");
  const wchar_t* alias_value = _wgetenv(L"PROCESSOR_SKILLS_PROJECT_ALIAS");
  if (root_value == nullptr || alias_value == nullptr) {
    return false;
  }
  const std::string root_generic = fs::path(root_value).generic_u8string();
  std::string root_native = root_generic;
  std::replace(root_native.begin(), root_native.end(), '/', '\\');
  const std::string alias = fs::path(alias_value).generic_u8string();
  const bool generic_changed = replace_all(value, root_generic, alias);
  const bool native_changed = replace_all(value, root_native, alias);
  return generic_changed || native_changed;
}

std::wstring replace_project_root(const std::wstring& value) {
  const wchar_t* root_value = _wgetenv(L"PROCESSOR_SKILLS_PROJECT_ROOT");
  const wchar_t* alias_value = _wgetenv(L"PROCESSOR_SKILLS_PROJECT_ALIAS");
  if (root_value == nullptr || alias_value == nullptr) {
    return value;
  }
  std::wstring rewritten = value;
  replace_all(rewritten, std::wstring(root_value), std::wstring(alias_value));
  std::wstring generic_root(root_value);
  std::replace(generic_root.begin(), generic_root.end(), L'\\', L'/');
  replace_all(rewritten, generic_root, std::wstring(alias_value));
  return rewritten;
}

bool replace_windows_clean_recipe(std::string& line) {
  const size_t first = first_content(line);
  if (first == std::string::npos) {
    return false;
  }
  if (line.compare(first, 7, "for /f ") == 0) {
    line = line.substr(0, first) +
           "ls . | grep -v Makefile | grep -v execution-script.txt | "
           "grep -v sourceFiles.F | xargs rm -rf";
    return true;
  }
  if (line.compare(first, 7, "for /d ") == 0) {
    line.clear();
    return true;
  }
  return false;
}

bool normalize_quoted_windows_paths(std::string& line) {
  bool changed = false;
  size_t begin = 0;
  while ((begin = line.find('\'', begin)) != std::string::npos) {
    const size_t end = line.find('\'', begin + 1);
    if (end == std::string::npos) {
      break;
    }
    const size_t drive = line.find(":\\", begin + 1);
    if (drive != std::string::npos && drive < end) {
      for (size_t index = begin + 1; index < end; ++index) {
        if (line[index] == '\\') {
          line[index] = '/';
          changed = true;
        }
      }
    }
    begin = end + 1;
  }
  return changed;
}

bool normalize_make_path_tokens(std::string& line) {
  bool changed = false;
  size_t search = 0;
  while (search + 2 < line.size()) {
    size_t drive = std::string::npos;
    for (size_t index = search; index + 2 < line.size(); ++index) {
      const unsigned char letter = static_cast<unsigned char>(line[index]);
      if (((letter >= 'A' && letter <= 'Z') ||
           (letter >= 'a' && letter <= 'z')) &&
          line[index + 1] == ':' &&
          (line[index + 2] == '\\' || line[index + 2] == '/')) {
        drive = index;
        break;
      }
    }
    if (drive == std::string::npos) {
      break;
    }

    size_t end = drive + 2;
    while (end < line.size()) {
      const bool whitespace = line[end] == ' ' || line[end] == '\t' ||
                              line[end] == '\r' || line[end] == '\n';
      if ((whitespace && (end == drive || line[end - 1] != '\\')) ||
          line[end] == '\'' || line[end] == '"') {
        break;
      }
      ++end;
    }

    std::string normalized;
    normalized.reserve(end - drive);
    bool previous_slash = false;
    for (size_t index = drive; index < end; ++index) {
      char character = line[index];
      if (character == '\\' && index + 1 < end && line[index + 1] == ' ') {
        normalized.push_back('\x1f');
        ++index;
        previous_slash = false;
        continue;
      }
      if (character == '\\') {
        character = '/';
      }
      if (character == '/') {
        if (previous_slash) {
          changed = true;
          continue;
        }
        previous_slash = true;
      } else {
        previous_slash = false;
      }
      if (character != line[index]) {
        changed = true;
      }
      normalized.push_back(character);
    }
    normalized = fs::path(normalized).lexically_normal().generic_string();
    size_t escaped_space = 0;
    while ((escaped_space = normalized.find('\x1f', escaped_space)) !=
           std::string::npos) {
      normalized.replace(escaped_space, 1, "\\ ");
      escaped_space += 2;
    }
    if (normalized != line.substr(drive, end - drive)) {
      line.replace(drive, end - drive, normalized);
      end = drive + normalized.size();
      changed = true;
    }
    search = end;
  }
  return changed;
}

bool replace_shell_pwd(std::string& line, const std::string& directory) {
  const std::string needle = "$(shell pwd)";
  bool changed = false;
  size_t position = 0;
  while ((position = line.find(needle, position)) != std::string::npos) {
    line.replace(position, needle.size(), directory);
    position += directory.size();
    changed = true;
  }
  return changed;
}

std::string escape_make_spaces(const std::string& value) {
  std::string result;
  result.reserve(value.size());
  for (const char character : value) {
    if (character == ' ') {
      result.push_back('\\');
    }
    result.push_back(character);
  }
  return result;
}

bool add_mingw_dpi_flag(std::string& line) {
  const std::string anchor = "-DSVSIM_ENABLE_VERILATOR_SUPPORT";
  if (line.find(anchor) == std::string::npos ||
      line.find("-DDPI_DLLISPEC=") != std::string::npos) {
    return false;
  }
  line.insert(line.find(anchor) + anchor.size(), " -DDPI_DLLISPEC=");
  return true;
}

bool patch_makefile(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    return false;
  }
  const std::string original((std::istreambuf_iterator<char>(input)),
                             std::istreambuf_iterator<char>());
  input.close();

  std::string patched;
  patched.reserve(original.size() + 16);
  std::error_code absolute_error;
  std::string make_directory = fs::absolute(path.parent_path(), absolute_error)
                                   .lexically_normal()
                                   .generic_u8string();
  if (absolute_error) {
    throw std::runtime_error("cannot resolve generated Makefile directory: " +
                             path.string());
  }
  replace_project_root(make_directory);
  make_directory = escape_make_spaces(make_directory);
  size_t begin = 0;
  bool changed = false;
  while (begin < original.size()) {
    const size_t end = original.find('\n', begin);
    const bool has_newline = end != std::string::npos;
    std::string line = original.substr(
        begin, has_newline ? end - begin : std::string::npos);
    const bool clean_changed = replace_windows_clean_recipe(line);
    const bool project_root_changed = replace_project_root(line);
    const bool quoted_path_changed = normalize_quoted_windows_paths(line);
    const bool make_path_changed = normalize_make_path_tokens(line);
    const bool pwd_changed = replace_shell_pwd(line, make_directory);
    const bool dpi_changed = add_mingw_dpi_flag(line);
    changed = clean_changed || project_root_changed || pwd_changed || dpi_changed ||
              quoted_path_changed || make_path_changed || changed;
    patched += line;
    if (has_newline) {
      patched.push_back('\n');
      begin = end + 1;
    } else {
      begin = original.size();
    }
  }
  if (!changed) {
    return false;
  }
  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  if (!output) {
    throw std::runtime_error("cannot update generated Makefile: " + path.string());
  }
  output.write(patched.data(), static_cast<std::streamsize>(patched.size()));
  if (!output) {
    throw std::runtime_error("cannot finish generated Makefile update: " +
                             path.string());
  }
  return true;
}

bool normalize_source_list(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    return false;
  }
  std::string content((std::istreambuf_iterator<char>(input)),
                      std::istreambuf_iterator<char>());
  input.close();
  bool changed = false;
  for (char& character : content) {
    if (character == '\\') {
      character = '/';
      changed = true;
    }
  }
  if (!changed) {
    return false;
  }
  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  if (!output) {
    throw std::runtime_error("cannot update generated source list: " + path.string());
  }
  output.write(content.data(), static_cast<std::streamsize>(content.size()));
  if (!output) {
    throw std::runtime_error("cannot finish generated source list update: " +
                             path.string());
  }
  return true;
}

bool patch_simulation_driver(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    return false;
  }
  std::string content((std::istreambuf_iterator<char>(input)),
                      std::istreambuf_iterator<char>());
  input.close();
  if (content.find("static int svsim_windows_getline") != std::string::npos) {
    return false;
  }
  const std::string call =
      "getline(&stringBuffer, &stringBufferLength, state.commandStream)";
  const size_t call_position = content.find(call);
  if (call_position == std::string::npos) {
    return false;
  }
  const std::string include = "#include <unistd.h>";
  const size_t include_position = content.find(include);
  if (include_position == std::string::npos) {
    throw std::runtime_error("cannot locate simulation driver include anchor: " +
                             path.string());
  }
  const std::string compatibility = R"(

#ifdef _WIN32
double sc_time_stamp() { return 0.0; }

static int svsim_windows_getline(char **buffer, size_t *capacity, FILE *stream) {
  if (buffer == NULL || capacity == NULL || stream == NULL) {
    return -1;
  }
  if (*buffer == NULL || *capacity == 0) {
    *capacity = 128;
    *buffer = (char *)malloc(*capacity);
    if (*buffer == NULL) {
      return -1;
    }
  }
  size_t length = 0;
  int character = 0;
  while ((character = fgetc(stream)) != EOF) {
    if (length + 1 >= *capacity) {
      size_t next_capacity = *capacity * 2;
      char *next = (char *)realloc(*buffer, next_capacity);
      if (next == NULL) {
        return -1;
      }
      *buffer = next;
      *capacity = next_capacity;
    }
    (*buffer)[length++] = (char)character;
    if (character == '\n') {
      break;
    }
  }
  if (length == 0 && character == EOF) {
    return -1;
  }
  (*buffer)[length] = '\0';
  return length > INT_MAX ? -1 : (int)length;
}
#endif
)";
  content.insert(include_position + include.size(), compatibility);
  content.replace(content.find(call), call.size(),
                  "svsim_windows_getline(&stringBuffer, &stringBufferLength, "
                  "state.commandStream)");
  const std::string null_device = "/dev/null";
  size_t null_position = 0;
  while ((null_position = content.find(null_device, null_position)) !=
         std::string::npos) {
    content.replace(null_position, null_device.size(), "NUL");
    null_position += 3;
  }
  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  if (!output) {
    throw std::runtime_error("cannot update generated simulation driver: " +
                             path.string());
  }
  output.write(content.data(), static_cast<std::streamsize>(content.size()));
  if (!output) {
    throw std::runtime_error("cannot finish simulation driver update: " +
                             path.string());
  }
  return true;
}

fs::path makefile_from_arguments(int argc, wchar_t** argv) {
  fs::path directory = fs::path(replace_project_root(fs::current_path().wstring()));
  fs::path makefile = "Makefile";
  for (int index = 1; index < argc; ++index) {
    const std::wstring argument(argv[index]);
    if ((argument == L"-C" || argument == L"--directory") && index + 1 < argc) {
      const fs::path requested(
          replace_project_root(std::wstring(argv[++index])));
      directory = requested.is_absolute() ? requested : directory / requested;
    } else if ((argument == L"-f" || argument == L"--file" ||
                argument == L"--makefile") &&
               index + 1 < argc) {
      makefile = fs::path(replace_project_root(std::wstring(argv[++index])));
    }
  }
  directory = fs::absolute(directory).lexically_normal();
  return makefile.is_absolute() ? makefile : directory / makefile;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  const wchar_t* real_make = _wgetenv(L"PROCESSOR_SKILLS_REAL_MAKE");
  if (real_make == nullptr || std::wstring(real_make).empty()) {
    std::wcerr << L"PROCESSOR_SKILLS_REAL_MAKE is not set\n";
    return 2;
  }
  try {
    const fs::path makefile = makefile_from_arguments(argc, argv);
    // A newly generated svsim Makefile can become visible through the logical
    // project path a few milliseconds before the subst alias sees it.  Wait
    // briefly so the first Make invocation is patched as reliably as retries.
    for (int attempt = 0; attempt < 50 && !fs::is_regular_file(makefile);
         ++attempt) {
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    if (fs::is_regular_file(makefile) && patch_makefile(makefile)) {
      std::wcerr << L"processor-skills patched the Chisel Windows clean recipe in "
                 << makefile.wstring() << L"\n";
    }
    const fs::path source_list = makefile.parent_path() / "sourceFiles.F";
    if (fs::is_regular_file(source_list) && normalize_source_list(source_list)) {
      std::wcerr << L"processor-skills normalized Chisel source paths in "
                 << source_list.wstring() << L"\n";
    }
    const std::vector<fs::path> driver_candidates = {
        makefile.parent_path().parent_path() / "generated-sources" /
            "simulation-driver.cpp",
        makefile.parent_path().parent_path().parent_path() /
            "generated-sources" / "simulation-driver.cpp",
    };
    for (const fs::path& driver : driver_candidates) {
      if (fs::is_regular_file(driver) && patch_simulation_driver(driver)) {
        std::wcerr << L"processor-skills added the Windows getline adapter to "
                   << driver.wstring() << L"\n";
        break;
      }
    }
  } catch (const std::exception& error) {
    std::cerr << "processor-skills make wrapper failed: " << error.what() << '\n';
    return 2;
  }

  std::vector<std::wstring> rewritten_arguments;
  rewritten_arguments.reserve(argc > 1 ? static_cast<size_t>(argc - 1) : 0);
  for (int index = 1; index < argc; ++index) {
    rewritten_arguments.push_back(replace_project_root(std::wstring(argv[index])));
  }
  std::vector<const wchar_t*> child_arguments;
  child_arguments.reserve(static_cast<size_t>(argc) + 1);
  child_arguments.push_back(real_make);
  for (const std::wstring& argument : rewritten_arguments) {
    child_arguments.push_back(argument.c_str());
  }
  child_arguments.push_back(nullptr);
  const intptr_t result =
      _wspawnv(_P_WAIT, real_make, child_arguments.data());
  if (result == -1) {
    std::wcerr << L"cannot launch real Make: " << real_make << L"\n";
    return 2;
  }
  return static_cast<int>(result);
}

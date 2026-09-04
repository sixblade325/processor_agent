#include <cstdlib>
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace {

std::vector<std::string> split(const std::string& value, char separator) {
  std::vector<std::string> result;
  std::string current;
  for (char character : value) {
    if (character == separator) {
      result.push_back(current);
      current.clear();
    } else {
      current.push_back(character);
    }
  }
  result.push_back(current);
  return result;
}

bool has_directory_component(const fs::path& value) {
  return value.has_parent_path() || value.has_root_name() || value.has_root_directory();
}

std::vector<std::string> extensions_for(const fs::path& command) {
  if (command.has_extension()) {
    return {""};
  }
  const char* raw = std::getenv("PATHEXT");
  const std::string value = raw == nullptr ? ".COM;.EXE;.BAT;.CMD" : raw;
  std::vector<std::string> result;
  for (std::string extension : split(value, ';')) {
    if (!extension.empty()) {
      result.push_back(extension);
    }
  }
  result.push_back("");
  return result;
}

void print_path(const fs::path& candidate) {
  std::error_code error;
  const fs::path absolute = fs::absolute(candidate, error).lexically_normal();
  std::cout << absolute.generic_string() << '\n';
}

bool print_match(const fs::path& directory, const fs::path& command) {
  std::string command_name = command.filename().string();
  std::transform(command_name.begin(), command_name.end(), command_name.begin(),
                 [](unsigned char character) {
                   return static_cast<char>(std::tolower(character));
                 });
  if (command_name == "verilator") {
    const fs::path native_verilator = directory / "verilator_bin.exe";
    std::error_code native_error;
    if (fs::is_regular_file(native_verilator, native_error)) {
      print_path(native_verilator);
      return true;
    }
  }
  for (const std::string& extension : extensions_for(command)) {
    const fs::path candidate = directory / fs::path(command.string() + extension);
    std::error_code error;
    if (fs::is_regular_file(candidate, error)) {
      print_path(candidate);
      return true;
    }
  }
  return false;
}

bool find_command(const std::string& argument) {
  const fs::path command(argument);
  if (has_directory_component(command)) {
    return print_match(fs::path(), command);
  }
  const char* raw_path = std::getenv("PATH");
  if (raw_path == nullptr) {
    return false;
  }
  for (const std::string& directory : split(raw_path, ';')) {
    if (!directory.empty() && print_match(fs::path(directory), command)) {
      return true;
    }
  }
  return false;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--version") {
    std::cout << "processor-skills-which 1.0\n";
    return 0;
  }
  if (argc < 2) {
    std::cerr << "usage: which <command> [command ...]\n";
    return 2;
  }
  bool all_found = true;
  for (int index = 1; index < argc; ++index) {
    if (!find_command(argv[index])) {
      all_found = false;
    }
  }
  return all_found ? 0 : 1;
}

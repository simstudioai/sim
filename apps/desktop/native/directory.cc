#include <node_api.h>

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <climits>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

struct Entry {
  std::string name;
  const char* kind;
};

struct DirectoryRead {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  int descriptor = -1;
  size_t limit = 0;
  bool truncated = false;
  std::string error;
  std::vector<Entry> entries;
};

static const char* EntryKind(DIR* directory, const dirent* entry) {
  switch (entry->d_type) {
    case DT_REG: return "file";
    case DT_DIR: return "directory";
    case DT_LNK: return "symlink";
    case DT_UNKNOWN: {
      struct stat metadata;
      if (fstatat(dirfd(directory), entry->d_name, &metadata, AT_SYMLINK_NOFOLLOW) == 0) {
        if (S_ISREG(metadata.st_mode)) return "file";
        if (S_ISDIR(metadata.st_mode)) return "directory";
        if (S_ISLNK(metadata.st_mode)) return "symlink";
      }
      return "other";
    }
    default: return "other";
  }
}

static void ReadEntries(napi_env, void* data) {
  auto* read = static_cast<DirectoryRead*>(data);
  DIR* directory = fdopendir(read->descriptor);
  if (!directory) {
    close(read->descriptor);
    read->descriptor = -1;
    read->error = "Could not enumerate the approved directory.";
    return;
  }
  read->descriptor = -1;
  while (true) {
    errno = 0;
    const dirent* entry = readdir(directory);
    if (!entry) {
      if (errno != 0) read->error = "Could not finish reading the approved directory.";
      break;
    }
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
    if (read->entries.size() == read->limit) {
      read->truncated = true;
      break;
    }
    read->entries.push_back({entry->d_name, EntryKind(directory, entry)});
  }
  closedir(directory);
}

static napi_value String(napi_env env, const char* value) {
  napi_value result;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result);
  return result;
}

static void Complete(napi_env env, napi_status status, void* data) {
  auto* read = static_cast<DirectoryRead*>(data);
  if (read->descriptor >= 0) close(read->descriptor);
  if (status != napi_ok || !read->error.empty()) {
    napi_value error;
    napi_create_error(env, nullptr,
                      String(env, read->error.empty() ? "Directory read cancelled." : read->error.c_str()),
                      &error);
    napi_reject_deferred(env, read->deferred, error);
  } else {
    napi_value result;
    napi_value entries;
    napi_value truncated;
    napi_create_object(env, &result);
    napi_create_array_with_length(env, read->entries.size(), &entries);
    for (size_t index = 0; index < read->entries.size(); index++) {
      napi_value entry;
      napi_create_object(env, &entry);
      napi_set_named_property(env, entry, "name", String(env, read->entries[index].name.c_str()));
      napi_set_named_property(env, entry, "kind", String(env, read->entries[index].kind));
      napi_set_element(env, entries, index, entry);
    }
    napi_get_boolean(env, read->truncated, &truncated);
    napi_set_named_property(env, result, "entries", entries);
    napi_set_named_property(env, result, "truncated", truncated);
    napi_resolve_deferred(env, read->deferred, result);
  }
  napi_delete_async_work(env, read->work);
  delete read;
}

/** The descriptor is duplicated before scheduling; no pathname is reopened by the worker. */
static napi_value ReadDirectory(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value arguments[2];
  double descriptor = -1;
  double limit = 0;
  if (napi_get_cb_info(env, info, &count, arguments, nullptr, nullptr) != napi_ok || count != 2 ||
      napi_get_value_double(env, arguments[0], &descriptor) != napi_ok ||
      napi_get_value_double(env, arguments[1], &limit) != napi_ok ||
      !std::isfinite(descriptor) || descriptor < 0 || descriptor > INT_MAX ||
      descriptor != std::floor(descriptor) || limit < 1 || limit > 1000 || limit != std::floor(limit)) {
    napi_throw_type_error(env, nullptr, "Expected a directory descriptor and an entry limit from 1 to 1000.");
    return nullptr;
  }
  auto* read = new DirectoryRead();
  read->limit = static_cast<size_t>(limit);
  read->descriptor = fcntl(static_cast<int>(descriptor), F_DUPFD_CLOEXEC, 0);
  if (read->descriptor < 0) {
    delete read;
    napi_throw_error(env, nullptr, "Could not retain the approved directory descriptor.");
    return nullptr;
  }
  napi_value promise;
  if (napi_create_promise(env, &read->deferred, &promise) != napi_ok ||
      napi_create_async_work(env, nullptr, String(env, "ReadApprovedDirectory"), ReadEntries,
                             Complete, read, &read->work) != napi_ok ||
      napi_queue_async_work(env, read->work) != napi_ok) {
    close(read->descriptor);
    if (read->work) napi_delete_async_work(env, read->work);
    delete read;
    napi_throw_error(env, nullptr, "Could not schedule the directory read.");
    return nullptr;
  }
  return promise;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor property = {
    "readDirectory", nullptr, ReadDirectory, nullptr, nullptr, nullptr, napi_default, nullptr
  };
  napi_define_properties(env, exports, 1, &property);
  return exports;
}

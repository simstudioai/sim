#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

#include <node_api.h>

#include <algorithm>
#include <iterator>
#include <string>
#include <vector>

constexpr NSInteger kMaximumResultCount = 20;
constexpr NSUInteger kMaximumQueryLength = 256;
constexpr int64_t kSearchDebounceNanoseconds = 200 * NSEC_PER_MSEC;

@interface SIMDocumentationHelpItem : NSObject

@property(nonatomic, copy) NSArray<NSString*>* localizedTitles;
@property(nonatomic, strong) NSURL* URL;

- (instancetype)initWithLocalizedTitles:(NSArray<NSString*>*)localizedTitles URL:(NSURL*)URL;

@end

@implementation SIMDocumentationHelpItem

- (instancetype)initWithLocalizedTitles:(NSArray<NSString*>*)localizedTitles URL:(NSURL*)URL {
  self = [super init];
  if (self) {
    _localizedTitles = [localizedTitles copy];
    _URL = URL;
  }
  return self;
}

@end

@interface SIMDocumentationHelpSearchProvider
    : NSObject <NSUserInterfaceItemSearching>

- (instancetype)initWithEndpoint:(NSURL*)endpoint;
- (void)cancel;

@end


@interface SIMDocumentationHelpSearchProvider ()

@property(nonatomic, strong) NSURL* endpoint;
@property(nonatomic, strong) NSURLSession* session;
@property(nonatomic, strong, nullable) NSURLSessionDataTask* currentTask;
@property(nonatomic) NSUInteger searchGeneration;

@end


@implementation SIMDocumentationHelpSearchProvider

- (instancetype)initWithEndpoint:(NSURL*)endpoint {
  self = [super init];
  if (self) {
    _endpoint = endpoint;

    NSURLSessionConfiguration* configuration =
        [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    configuration.timeoutIntervalForRequest = 8;
    configuration.timeoutIntervalForResource = 10;
    configuration.HTTPMaximumConnectionsPerHost = 1;
    configuration.HTTPAdditionalHeaders = @{
      @"Accept" : @"application/json",
      @"User-Agent" : @"Sim Desktop Help Search"
    };
    _session = [NSURLSession sessionWithConfiguration:configuration];
  }
  return self;
}

- (void)cancel {
  @synchronized(self) {
    self.searchGeneration += 1;
    [self.currentTask cancel];
    self.currentTask = nil;
  }
}

- (void)searchForItemsWithSearchString:(NSString*)searchString
                           resultLimit:(NSInteger)resultLimit
                    matchedItemHandler:
                        (void (^)(NSArray* items))handleMatchedItems {
  NSString* query = [searchString
      stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (query.length == 0) {
    handleMatchedItems(@[]);
    return;
  }
  if (query.length > kMaximumQueryLength) {
    query = [query substringToIndex:kMaximumQueryLength];
  }

  NSInteger boundedLimit =
      std::clamp(resultLimit, static_cast<NSInteger>(1), kMaximumResultCount);
  __block NSUInteger generation;
  @synchronized(self) {
    self.searchGeneration += 1;
    generation = self.searchGeneration;
    [self.currentTask cancel];
    self.currentTask = nil;
  }

  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, kSearchDebounceNanoseconds),
      dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @synchronized(self) {
          if (generation != self.searchGeneration) {
            return;
          }
        }

        NSURLComponents* components =
            [NSURLComponents componentsWithURL:self.endpoint resolvingAgainstBaseURL:NO];
        components.queryItems = @[
          [NSURLQueryItem queryItemWithName:@"query" value:query],
          [NSURLQueryItem queryItemWithName:@"locale" value:@"en"],
          [NSURLQueryItem queryItemWithName:@"limit"
                                      value:[NSString stringWithFormat:@"%ld",
                                                                       boundedLimit]],
        ];
        NSURL* requestURL = components.URL;
        if (!requestURL) {
          handleMatchedItems(@[]);
          return;
        }

        __block NSURLSessionDataTask* task = nil;
        task = [self.session
            dataTaskWithURL:requestURL
          completionHandler:^(NSData* data, NSURLResponse* response, NSError* error) {
            @synchronized(self) {
              if (generation != self.searchGeneration || self.currentTask != task) {
                return;
              }
              self.currentTask = nil;
            }

            if (error || !data) {
              handleMatchedItems(@[]);
              return;
            }

            NSHTTPURLResponse* httpResponse =
                [response isKindOfClass:[NSHTTPURLResponse class]]
                    ? (NSHTTPURLResponse*)response
                    : nil;
            if (!httpResponse || httpResponse.statusCode < 200 ||
                httpResponse.statusCode >= 300) {
              handleMatchedItems(@[]);
              return;
            }

            NSError* jsonError = nil;
            id payload = [NSJSONSerialization JSONObjectWithData:data options:0 error:&jsonError];
            if (jsonError || ![payload isKindOfClass:[NSArray class]]) {
              handleMatchedItems(@[]);
              return;
            }

            NSMutableArray<SIMDocumentationHelpItem*>* items = [NSMutableArray array];
            for (id rawResult in (NSArray*)payload) {
              if (items.count >= static_cast<NSUInteger>(boundedLimit) ||
                  ![rawResult isKindOfClass:[NSDictionary class]]) {
                continue;
              }

              NSDictionary* result = (NSDictionary*)rawResult;
              id rawTitle = result[@"content"];
              id rawURL = result[@"url"];
              if (![rawTitle isKindOfClass:[NSString class]] ||
                  ![rawURL isKindOfClass:[NSString class]]) {
                continue;
              }

              NSString* title = [(NSString*)rawTitle
                  stringByTrimmingCharactersInSet:
                      [NSCharacterSet whitespaceAndNewlineCharacterSet]];
              if (title.length == 0) {
                continue;
              }

              NSURL* resultURL = [NSURL URLWithString:(NSString*)rawURL
                                          relativeToURL:[NSURL URLWithString:@"https://docs.sim.ai/"]];
              resultURL = resultURL.absoluteURL;
              if (![resultURL.scheme.lowercaseString isEqualToString:@"https"] ||
                  ![resultURL.host.lowercaseString isEqualToString:@"docs.sim.ai"]) {
                continue;
              }

              NSMutableArray<NSString*>* localizedTitles =
                  [NSMutableArray arrayWithObject:@"Sim Documentation"];
              id rawBreadcrumbs = result[@"breadcrumbs"];
              if ([rawBreadcrumbs isKindOfClass:[NSArray class]]) {
                for (id rawBreadcrumb in (NSArray*)rawBreadcrumbs) {
                  if (localizedTitles.count >= 5 ||
                      ![rawBreadcrumb isKindOfClass:[NSString class]]) {
                    continue;
                  }
                  NSString* breadcrumb = [(NSString*)rawBreadcrumb
                      stringByTrimmingCharactersInSet:
                          [NSCharacterSet whitespaceAndNewlineCharacterSet]];
                  if (breadcrumb.length > 0 && ![breadcrumb isEqualToString:title]) {
                    [localizedTitles addObject:breadcrumb];
                  }
                }
              }
              [localizedTitles addObject:title];

              [items addObject:[[SIMDocumentationHelpItem alloc]
                                   initWithLocalizedTitles:localizedTitles
                                                       URL:resultURL]];
            }

            handleMatchedItems(items);
          }];

        @synchronized(self) {
          if (generation != self.searchGeneration) {
            [task cancel];
            return;
          }
          self.currentTask = task;
        }
        [task resume];
      });
}

- (NSArray<NSString*>*)localizedTitlesForItem:(id)item {
  if (![item isKindOfClass:[SIMDocumentationHelpItem class]]) {
    return @[];
  }
  SIMDocumentationHelpItem* result = (SIMDocumentationHelpItem*)item;
  return result.localizedTitles;
}

- (void)performActionForItem:(id)item {
  if (![item isKindOfClass:[SIMDocumentationHelpItem class]]) {
    return;
  }
  SIMDocumentationHelpItem* result = (SIMDocumentationHelpItem*)item;
  [[NSWorkspace sharedWorkspace] openURL:result.URL];
}

@end

static __strong SIMDocumentationHelpSearchProvider* gProvider = nil;

bool ReadStringArgument(napi_env env,
                        napi_callback_info info,
                        std::string* value) {
  size_t argument_count = 1;
  napi_value arguments[1];
  if (napi_get_cb_info(env, info, &argument_count, arguments, nullptr, nullptr) != napi_ok ||
      argument_count != 1) {
    napi_throw_type_error(env, nullptr, "install expects one endpoint URL");
    return false;
  }

  napi_valuetype type;
  if (napi_typeof(env, arguments[0], &type) != napi_ok || type != napi_string) {
    napi_throw_type_error(env, nullptr, "endpoint URL must be a string");
    return false;
  }

  size_t length = 0;
  if (napi_get_value_string_utf8(env, arguments[0], nullptr, 0, &length) != napi_ok) {
    napi_throw_type_error(env, nullptr, "could not read endpoint URL");
    return false;
  }
  std::vector<char> buffer(length + 1);
  if (napi_get_value_string_utf8(env, arguments[0], buffer.data(), buffer.size(), &length) !=
      napi_ok) {
    napi_throw_type_error(env, nullptr, "could not read endpoint URL");
    return false;
  }
  value->assign(buffer.data(), length);
  return true;
}

void UnregisterProvider() {
  @autoreleasepool {
    if (!gProvider) {
      return;
    }
    [gProvider cancel];
    [NSApp unregisterUserInterfaceItemSearchHandler:gProvider];
    gProvider = nil;
  }
}

napi_value BooleanResult(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

napi_value Install(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    std::string endpoint_string;
    if (!ReadStringArgument(env, info, &endpoint_string)) {
      return nullptr;
    }

    NSString* endpoint_text =
        [[NSString alloc] initWithBytes:endpoint_string.data()
                                 length:endpoint_string.size()
                               encoding:NSUTF8StringEncoding];
    NSURL* endpoint = endpoint_text ? [NSURL URLWithString:endpoint_text] : nil;
    if (!endpoint || ![endpoint.scheme.lowercaseString isEqualToString:@"https"] ||
        ![endpoint.host.lowercaseString isEqualToString:@"docs.sim.ai"] ||
        ![endpoint.path isEqualToString:@"/api/search"] || NSApp == nil) {
      return BooleanResult(env, false);
    }

    UnregisterProvider();
    gProvider = [[SIMDocumentationHelpSearchProvider alloc] initWithEndpoint:endpoint];
    [NSApp registerUserInterfaceItemSearchHandler:gProvider];
    return BooleanResult(env, true);
  }
}

napi_value Uninstall(napi_env env, napi_callback_info info) {
  UnregisterProvider();
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

void Cleanup(void*) {
  if ([NSThread isMainThread]) {
    UnregisterProvider();
    return;
  }
  dispatch_sync(dispatch_get_main_queue(), ^{
    UnregisterProvider();
  });
}

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"install", nullptr, Install, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"uninstall", nullptr, Uninstall, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, std::size(properties), properties);
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  return exports;
}

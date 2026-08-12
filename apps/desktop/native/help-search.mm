#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

#include <node_api.h>

#include <algorithm>
#include <atomic>
#include <iterator>
#include <string>
#include <vector>

constexpr NSInteger kMaximumResultCount = 20;
constexpr NSUInteger kMaximumQueryLength = 256;
constexpr NSUInteger kMaximumResponseLength = 512 * 1024;
constexpr NSUInteger kMaximumDisplayTextLength = 240;
constexpr int64_t kSearchDebounceNanoseconds = 200 * NSEC_PER_MSEC;

/**
 * This native trust anchor intentionally duplicates the JS-configured origin:
 * caller input must not widen where Help can fetch or open results.
 */
static NSString* const kDocumentationBaseURL = @"https://docs.sim.ai/";
static NSString* const kDocumentationHost = @"docs.sim.ai";
static NSString* const kDocumentationSearchPath = @"/api/search";

static bool IsTrustedDocumentationURL(NSURL* URL) {
  NSURLComponents* components =
      URL ? [NSURLComponents componentsWithURL:URL resolvingAgainstBaseURL:NO] : nil;
  return components && [components.scheme.lowercaseString isEqualToString:@"https"] &&
         [components.host.lowercaseString isEqualToString:kDocumentationHost] &&
         components.user == nil && components.password == nil && components.port == nil;
}

static bool IsTrustedSearchEndpoint(NSURL* URL, bool allowsQuery) {
  if (!IsTrustedDocumentationURL(URL)) {
    return false;
  }
  NSURLComponents* components =
      [NSURLComponents componentsWithURL:URL resolvingAgainstBaseURL:NO];
  return [components.path isEqualToString:kDocumentationSearchPath] &&
         components.fragment == nil && (allowsQuery || components.query == nil);
}

static NSString* SanitizeDisplayText(id rawText) {
  if (![rawText isKindOfClass:[NSString class]]) {
    return nil;
  }
  NSString* text = [[(NSString*)rawText
      componentsSeparatedByCharactersInSet:[NSCharacterSet controlCharacterSet]]
      componentsJoinedByString:@" "];
  text = [text
      stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (text.length > kMaximumDisplayTextLength) {
    NSRange safeRange = [text
        rangeOfComposedCharacterSequencesForRange:NSMakeRange(0, kMaximumDisplayTextLength)];
    text = [text substringWithRange:safeRange];
  }
  return text.length > 0 ? text : nil;
}

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
    : NSObject <NSUserInterfaceItemSearching, NSURLSessionTaskDelegate>

- (instancetype)initWithEndpoint:(NSURL*)endpoint;
- (void)invalidate;

@end


@interface SIMDocumentationHelpSearchProvider ()

@property(nonatomic, strong) NSURL* endpoint;
@property(nonatomic, strong, nullable) NSURLSession* session;
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
    configuration.URLCache = nil;
    configuration.HTTPCookieStorage = nil;
    configuration.URLCredentialStorage = nil;
    configuration.HTTPShouldSetCookies = NO;
    configuration.HTTPAdditionalHeaders = @{
      @"Accept" : @"application/json",
      @"User-Agent" : @"Sim Desktop Help Search"
    };
    _session = [NSURLSession sessionWithConfiguration:configuration
                                             delegate:self
                                        delegateQueue:nil];
  }
  return self;
}

- (void)invalidate {
  NSURLSession* session = nil;
  @synchronized(self) {
    self.searchGeneration += 1;
    [self.currentTask cancel];
    self.currentTask = nil;
    session = self.session;
    self.session = nil;
  }
  [session invalidateAndCancel];
}

- (void)URLSession:(NSURLSession*)session
                        task:(NSURLSessionTask*)task
    willPerformHTTPRedirection:(NSHTTPURLResponse*)response
                    newRequest:(NSURLRequest*)request
              completionHandler:(void (^)(NSURLRequest* _Nullable))completionHandler {
  (void)session;
  (void)task;
  (void)response;
  (void)request;
  completionHandler(nil);
}

- (void)searchForItemsWithSearchString:(NSString*)searchString
                           resultLimit:(NSInteger)resultLimit
                    matchedItemHandler:
                        (void (^)(NSArray* items))handleMatchedItems {
  void (^handleNoMatches)(void) = ^{
    handleMatchedItems(@[]);
  };
  NSString* query = [searchString
      stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (query.length == 0) {
    handleNoMatches();
    return;
  }
  if (resultLimit <= 0) {
    handleNoMatches();
    return;
  }
  if (query.length > kMaximumQueryLength) {
    NSRange safeRange = [query
        rangeOfComposedCharacterSequencesForRange:NSMakeRange(0, kMaximumQueryLength)];
    query = [query substringWithRange:safeRange];
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
          handleNoMatches();
          return;
        }

        __block __weak NSURLSessionDataTask* task = nil;
        void (^completionHandler)(NSData*, NSURLResponse*, NSError*) =
            ^(NSData* data, NSURLResponse* response, NSError* error) {
            @synchronized(self) {
              if (generation != self.searchGeneration || self.currentTask != task) {
                return;
              }
              self.currentTask = nil;
            }

            if (error || !data || data.length > kMaximumResponseLength) {
              handleNoMatches();
              return;
            }

            NSHTTPURLResponse* httpResponse =
                [response isKindOfClass:[NSHTTPURLResponse class]]
                    ? (NSHTTPURLResponse*)response
                    : nil;
            if (!httpResponse || httpResponse.statusCode < 200 ||
                httpResponse.statusCode >= 300 ||
                !IsTrustedSearchEndpoint(httpResponse.URL, true)) {
              handleNoMatches();
              return;
            }

            NSError* jsonError = nil;
            id payload = [NSJSONSerialization JSONObjectWithData:data options:0 error:&jsonError];
            if (jsonError || ![payload isKindOfClass:[NSArray class]]) {
              handleNoMatches();
              return;
            }

            NSMutableArray<SIMDocumentationHelpItem*>* items = [NSMutableArray array];
            for (id rawResult in (NSArray*)payload) {
              if (items.count >= static_cast<NSUInteger>(boundedLimit)) {
                break;
              }
              if (![rawResult isKindOfClass:[NSDictionary class]]) {
                continue;
              }

              NSDictionary* result = (NSDictionary*)rawResult;
              id rawURL = result[@"url"];
              if (![rawURL isKindOfClass:[NSString class]]) {
                continue;
              }

              NSString* title = SanitizeDisplayText(result[@"content"]);
              if (!title) {
                continue;
              }

              NSURL* resultURL = [NSURL URLWithString:(NSString*)rawURL
                                        relativeToURL:[NSURL URLWithString:kDocumentationBaseURL]];
              resultURL = resultURL.absoluteURL;
              if (!IsTrustedDocumentationURL(resultURL)) {
                continue;
              }

              NSMutableArray<NSString*>* localizedTitles =
                  [NSMutableArray arrayWithObject:@"Sim Documentation"];
              id rawBreadcrumbs = result[@"breadcrumbs"];
              if ([rawBreadcrumbs isKindOfClass:[NSArray class]]) {
                for (id rawBreadcrumb in (NSArray*)rawBreadcrumbs) {
                  if (localizedTitles.count >= 5) {
                    break;
                  }
                  NSString* breadcrumb = SanitizeDisplayText(rawBreadcrumb);
                  if (breadcrumb && ![breadcrumb isEqualToString:title] &&
                      ![localizedTitles containsObject:breadcrumb]) {
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
          };

        @synchronized(self) {
          if (generation != self.searchGeneration || !self.session) {
            return;
          }
          task = [self.session dataTaskWithURL:requestURL
                             completionHandler:completionHandler];
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
static std::atomic<napi_env> gOwnerEnvironment{nullptr};

static bool ReadStringArgument(napi_env env,
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

static void UnregisterProvider() {
  @autoreleasepool {
    if (!gProvider) {
      gOwnerEnvironment.store(nullptr);
      return;
    }
    [gProvider invalidate];
    [NSApp unregisterUserInterfaceItemSearchHandler:gProvider];
    gProvider = nil;
    gOwnerEnvironment.store(nullptr);
  }
}

static void UnregisterProviderOnMainThread() {
  if ([NSThread isMainThread]) {
    UnregisterProvider();
    return;
  }
  dispatch_sync(dispatch_get_main_queue(), ^{
    UnregisterProvider();
  });
}

static napi_value BooleanResult(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

static napi_value Install(napi_env env, napi_callback_info info) {
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
    if (!IsTrustedSearchEndpoint(endpoint, false) || NSApp == nil ||
        ![NSThread isMainThread]) {
      return BooleanResult(env, false);
    }

    UnregisterProvider();
    gProvider = [[SIMDocumentationHelpSearchProvider alloc] initWithEndpoint:endpoint];
    gOwnerEnvironment.store(env);
    [NSApp registerUserInterfaceItemSearchHandler:gProvider];
    return BooleanResult(env, true);
  }
}

static napi_value Uninstall(napi_env env, napi_callback_info info) {
  (void)info;
  if (env == gOwnerEnvironment.load()) {
    UnregisterProviderOnMainThread();
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static void Cleanup(void* data) {
  if (data == gOwnerEnvironment.load()) {
    UnregisterProviderOnMainThread();
  }
}

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"install", nullptr, Install, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"uninstall", nullptr, Uninstall, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, std::size(properties), properties);
  napi_add_env_cleanup_hook(env, Cleanup, env);
  return exports;
}

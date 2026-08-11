# Agiloft REST API — authoritative spec (transcribed from live help.agiloft.com)

## GLOBAL / API Security
- Every REST call should contain credentials as `login={login}&password={password}`.
- POST-body credentials supported ONLY for: /ewws/EWRead, /ewws/EWSelect, /ewws/EWCreate,
  /ewws/EWUpdate, /ewws/EWDelete. ("avoid passing the login or password ... by using POST
  instead of GET to pass the parameters in the request body")
- JWT: EWLogin returns a token; "The token can then be used in an Authorization request header,
  prefixed by the authentication scheme, instead of including the login and password parameters
  in following requests." Default scheme Bearer, expiry 15 min (token_expires_in, max 60).
- Statefulness: pattern is "login, do multiple calls, logout". EWLogout terminates the session
  associated with the token passed in the Authorization header.
- DELAYS: every REST call has a delay after completion, default 1 second, global var WSDelay.
- Group must be REST-enabled (Setup > System > Manage Web Services > Groups allowed for REST),
  else 403.

### General error codes (selected)
- 400 "There is no permissions to access this resource"
- 400 "One has to specify $login and $password parameters or authentication token."  <-- BOTH auth methods provided
- 400 "Token is expired"
- 400 "One has to specify $login, $password parameters or use $genhotlink/$genproject pair ..." <-- no auth
- 401 "Wrong Authorization data" <-- invalid authorization scheme
- 401 "Token is blocked" / "User is blocked"
- 403 invalid login attempt / "Authentication failed." / "Invalid login/password combination ..."
- 500 "No active session found for current token"
- 400 "Unable to identify KB with name" / "Cannot find specified knowledgebase: <KBName>"
- 400 "One has to specify $table, $KB, $lang parameters or use $genhotlink/$genproject pair ..."
- 400 "Wrong combination of access token and KB name. No access to data in KB"
- 400 "One has to specify id value."
- 400 "Project <projectId> has not been found" / "Table <tableId> has not been found"
- 400 "No value for 'field' parameter specified."
- 403 "not allowed, please check logs" (IP blacklist)
- 405 "HTTP method <methodName> is not supported by this URL"

## URL CONVENTIONS
- KB names and table names are CASE SENSITIVE (use Logical Table Name).
- REST style: `/ewws/REST/{kbName}/{table}[/{id}]?$login={login}&password={password}&lang={lang}&...`
  (omit /{id} for Create)
- GET/POST style: `/ewws/{operation}?$KB={kbName}&$table={table}&$login={login}&password={password}&lang={lang}&...`
  "The parameters of the POST request can be inserted into the body of the request to conceal the user credentials."
- Return values: JavaScript eval() form, all names prefixed `EWREST_`. Empty fields returned as nulls.
- JSON decorator: append `/.json` -> `{"success":true,"message":"","result":{...}}`
  optional `err_code_resp=1` for real status codes instead of always 200.
- Async decorator: `/ewws/async/EWCreate?...` or `/ewws/EWCreate/.async?...` (EWCreate, EWUpdate, EWDelete)
- Redirect decorator: `/ewws/redirect/...` with $exiturl and $errorurl
- Decorators chain left to right.

## OPERATIONS TABLE (endpoint / methods / returns)
| Create | GET/POST | /ewws/EWCreate | ID of new record |
| Read | GET/POST | /ewws/EWRead | encoded record info |
| Update | GET/POST | /ewws/EWUpdate | encoded record info after update |
| Delete | GET/POST/DELETE | /ewws/EWDelete | nothing |
| Select | GET/POST | /ewws/EWSelect | list of record ids + length |
| Login | GET/POST | /ewws/EWLogin | session token, expiration, auth scheme |
| Logout | GET/POST | /ewws/EWLogout | nothing |
| Search | GET/POST | /ewws/EWSearch | saved search + ad hoc |
| Attach | PUT | /ewws/EWAttach | total files attached |
| RemoveAttached | GET/POST | /ewws/EWRemoveAttachment | nothing |
| RetrieveAttached | GET/POST | /ewws/EWRetrieve | attachment |
| Lock | GET/PUT/DELETE | /ewws/EWLock | lock status |
| AttachInfo | GET/POST | /ewws/EWAttachInfo | attachment info |
| Hotlink | POST | /ewws/EWHotlinks | hotlink |
| Table | GET/POST | /ewws/EWTable | all tables and fields |
| Async Status | GET/POST | /ewws/EWAsyncStatus | execution status |
| GetChoiceLineId | GET | /ewws/GetChoiceLineID | internal id for a choice value |
| Action Button | POST | /ewws/EWActionButton | runs an action button |
| Saved Search | GET/POST | /ewws/EWSavedSearch | saved search details |

NOTE: the operations table lists `/ewws/GetChoiceLineID` and `/ewws/EWActionButton`, but the
detail pages use `/ewws/EWGetChoiceLineId` and `/ewws/async/EWActionButton`. Detail pages carry
working curl examples; the table does not.

## EWLogin
POST /ewws/EWLogin, Content-Type: plain/text.
Params (CAN BE FILLED TO REQUEST BODY): $KB, $login, $password, $lang (default en).
Response JSON: access_token, refresh_token, expiration_time_unit, expires_in, authentication_scheme
  (default "Bearer " — NOTE TRAILING SPACE in examples).
Example: POST https://server/ewws/EWLogin?$login=user&$password=passwd&$KB=Demo&$lang=en
Refresh: POST /ewws/EWLogin with Authorization header + body refresh_token=...
Logout: POST or GET /ewws/EWLogout with Authorization header; params $KB, $lang.
Errors: 400 no refresh_token / wrong refresh_token; 401 Refresh Token is expired;
        403 "User <userName> lacks permission log in"

## EWCreate
GET/POST /ewws/EWCreate. Content-Type application/x-www-form-urlencoded.
Params in URL/body: $KB, $table, $login, $password, $lang + field values.
Returns: EWREST_id='353';
Async-compatible.
Errors: 400 "Wrong format/value pointed to <columnName>"; linked-field errors.

## EWRead
GET/POST /ewws/EWRead. Params: $KB,$table,$login,$password,$lang,id
Alternative to id: $searchSQL=ext_id='a0B2c345' (must match exactly one record).
Returns EWREST_<field>='<value>'; lines including EWREST_id.
Errors: 400 "no data found for id range(s)"

## EWUpdate
GET/POST /ewws/EWUpdate. Params: ... id=358 + field values.
Alternative to id: $searchSQL.
$operationHints=NOLOCK forces update on a locked record (URL or POST body).
Returns full updated record as EWREST_ lines.
Errors: 400 "One has to specify id or searchSQL value."; constraint violations.

## EWDelete
GET/POST/DELETE /ewws/EWDelete. Params: ... id=358 & deleteRule=...
deleteRule values: ERROR_IF_DEPENDANTS, APPLY_DELETE_WHERE_POSSIBLE,
  DELETE_WHERE_POSSIBLE_OTHERWISE_UNLINK, APPLY_UNLINK,
  UNLINK_WHERE_POSSIBLE_OTHERWISE_DELETE, REPLACE_WITH_ANOTHER (needs `subs`).
Returns nothing on success; error message on failure.
Errors: 400 "One has to specify deleteRule, id and substitute values.";
        409 "Operation cannot be done. Record has <n> dependants" etc.

## EWSelect
GET/POST /ewws/EWSelect. Params: ... where=<sql where clause>
Queries in the URL must use %N equivalent operators.
SQL uses dbname column names. Choice values via GetChoiceLineId.
Limit via DB syntax e.g. "limit 0,200". No sort control (use EWSearch).
Returns: EWREST_id_length = '3'; EWREST_id_0 = '150'; ...
Empty: EWREST_id_length = '0';
Errors: 400 "Error <error> parsing the query <query>"; 500 "Error executing query, please consult logs"

## EWSearch
GET/POST /ewws/EWSearch. Content-Type x-www-form-urlencoded.
Params: $KB,$table,$login,$password,$lang, search=<saved search label>, query=<ad hoc>,
        field=<repeated>, page, limit
Operators: = %3D | != %21%3D | ~= %7E%3D (contains) | && %26%26 | || %7C%7C | < <= > >=
Surround each search value in single quotes; if a field label contains spaces, quote the label too.
Empty fields designated with null.
Returns: EWREST_length = '4'; then EWREST_<field>_<i>='value';
Empty: EWREST_id_length = '0';
Pagination: page starts 0. limit 0 = ALL records on page 0.
  "The REST interface creates a new session and performs an explicit logout for each call.
   As such, though pagination is available, the query will always be rebuilt and rerun."
ALREST EQUIVALENT (documented in this page):
  curl --location 'http://localhost:8080/ewws/alrest/CLM Template/case/search?lang=en' \
  --data '{ "field": ["id","summary"], "query": "summary=test" }'
Errors: 400 "No search <savedSearch> for table <tableName>"; 400 "No column <columnName> in table <tableName>"

## EWAttach
PUT /ewws/EWAttach. Content-Type multipart/form-data (file in body).
Params: $KB,$table,$login,$password,id,field,fileName
Returns: EWREST_someField.length='1';   (key is `<fieldName>.length`)
Errors: 400 "No value for 'fileName' parameter specified."; forbidden extension etc.

## EWAttachInfo
GET/POST /ewws/EWAttachInfo. Example uses /.json
URL: /ewws/EWAttachInfo/.json?$KB=..&$table=..&$lang=en&field=attached_file&$login=..&$password=..&id=1
Returns: {"success":true,"message":"","result":[{"fileName":"..","size":22126,"filePosition":0}]}

## EWRemoveAttachment
GET/POST /ewws/EWRemoveAttachment. Params: $KB,$table,$login,$password,id,field,filePosition
Returns: the number of attached files remaining in the field.

## EWRetrieve
GET/POST /ewws/EWRetrieve. Params: $KB,$table,$login,$password,id,field,filePosition
Returns: file content in body. Content-Type = the type used when attaching.

## EWLock
GET (status) / PUT (lock) / DELETE (unlock) /ewws/EWLock
Params: $KB,$table,$lang,id (+ $login/$password OR OAuth/JWT). `force` (any value) on DELETE only.
Success JSON: {"id":18,"table_id":2788,"locked_by":"admin","lock_status":"LOCKED","lock_expires_in_minutes":25}
Unlock: {"id":18,"table_id":2788,"lock_status":"NO_LOCK"}
lock_status values: NO_LOCK | LOCKED
Failure JSON: {error, error_description}; codes BAD_REQUEST/UNAUTHORIZED/FORBIDDEN/CONFLICT/SERVER_ERROR

## EWGetChoiceLineId
GET. Detail page URL: /ewws/EWGetChoiceLineId?$KB=..&$login=..&$password=..&$table=case&$lang=en&field=priority&value=High
Returns: EWREST_choiceLineId = '1';
No match -> HTTP 400.
Errors: 400 "No choice line found for value <fieldName>"; 500 unexpected

## EWActionButton
POST ONLY. URL: /ewws/async/EWActionButton?$KB=..&$login=..&$password=..&$lang=en&$table=case&name=ab_field&id=82
Returns: EWREST_id='82'; EWREST_EWCALLBACK_ID='10100_1';
Compatible with EWAsyncStatus.
Errors: 400 "Wrong value for 'sequence' parameter"; 400 "No information for requested column <fieldName>"

## EWAsyncStatus
GET or POST /ewws/EWAsyncStatus. Params: $KB,$login,$password,$lang,$table,callback_id
Returns response CODE only (empty body): 200 completed, 201 queued, 202 in progress,
  501 failed, 523 no info for callback id.

## EWSavedSearch
GET/POST /ewws/EWSavedSearch/.json  (JSON is the ONLY output; /.json is MANDATORY)
URL must include the logical table name. For POST the table param may be in the body.
MUST be used with EWLogin or OAuth 2.0 authorization. Never asynchronous.
Example: https://localhost:8080/ewws/EWSavedSearch/.json?$table=contract
Returns: {"success":true,"message":"","result":[{"label":"...","name":"...","id":265185,"description":""}]}

## EWTable
GET/POST /ewws/EWTable/.json. Requests x-www-form-urlencoded; returns application/json.
MUST be used with EWLogin or OAuth 2.0 authorization. Never asynchronous.
Params: $KB; optional `table` (plain, NOT $table) = logical name e.g. table=contacts;
        includelinkedinfo=true; skipColumnsInfo=true
Example: https://localhost:8080/ewws/EWTable/.json?$KB=Demo&includelinkedinfo=true
Returns: {"success":true,"message":"","result":{"tables":[{"label":"WMI Sample","logicalName":"wmi_sample",
  "fields":[{"columnLabel":"ID","columnName":"id","columnType":"BIGINT","columnTypeDomain":"swautoincrementfield"},
  {"columnLabel":"Updated By","columnName":"_1794_full_name","columnType":"VARCHAR",
   "columnTypeDomain":"swshorttextfield","isLinked":true,
   "linkedInfo":[{"linkedTable":"contacts","linkedColumn":"full_name","linkedDao":"_dao3_link0"}],
   "textFieldType":"text/plain"}]}]}}
Returns for fields: name, label, type, and required flag. Linked fields return only source table info.
Action buttons, related tables, embedded search results, embedded communications NOT supported.

## EWUpsert
POST /ewws/EWUpsert. Content-Type application/x-www-form-urlencoded.
Authentication: Required ($login and $password).
Async support: Yes (EWAsyncStatus) via $async.
System params: $KB*, $table*, $login*, $password*, $match*, $lang, $async
Remaining params are record fields.
Matching: no match -> create; one match -> update; multiple -> error.
Example body: $KB=Demo / $table=contacts.employees / $login=admin / $password=qwerty /
              $lang=en / $match=_login / _login=jdoe / first_name=John / ...
Returns: EWREST_id='353';
Status: 200 updated, 201 created, 202 accepted(async), 400, 401, 403, 404,
        409 Conflict (multiple matching records), 500

## EWNLPSearch
Content-Types: application/json, application/x-www-form-urlencoded
Params: $KB*, $login*, $password*, $lang, field[]* , nlp_query*, page, limit
Returns same format as REST-Search.
Example return: {"success":true,"message":"","result":[{"company_name":"...","id":31,...}]}

## DATA ENCODING
- Choice fields: text value as in GUI (`&country=USA`). For EWSelect ad hoc queries use
  GetChoiceLineId IDs instead.
- Multi-choice: repeated key/value pairs.
- Elapsed time: "days:hours:minutes:seconds" e.g. "0:1:35:15"
- Linked fields: Query By Example with ':' qualifier (`&company_name=:Agiloft` or
  `&company_name=Company:Agiloft`). ':' and '?' in values escaped with backslash.
  SQL sub-select form uses '?' qualifier.
- File/image fields: POST with enctype multipart/form-data; form field name = file field name;
  `fieldName$overwrite` to replace rather than add.

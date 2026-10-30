interface RequestInput {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  fields?: Array<{ name: string; value: string; file: boolean }>
}

const quote = (value: string) => JSON.stringify(value)

/** Native HTTP examples preserve request bytes and copy response bytes as they arrive. */
export function nativeRequestSamples({ method, url, headers, body, fields }: RequestInput) {
  const goImports = ['io', 'net/http', 'os']
  const goBody: string[] = []
  let goPayload = 'nil'
  const javaBody: string[] = []
  let javaPayload = 'HttpRequest.BodyPublishers.noBody()'
  const csharpBody: string[] = []
  if (fields) {
    goImports.push('bytes', 'mime/multipart')
    goBody.push('payload := new(bytes.Buffer)', 'writer := multipart.NewWriter(payload)')
    javaBody.push(
      'String boundary = "SimDocs-" + java.util.UUID.randomUUID();',
      'var parts = new java.util.ArrayList<HttpRequest.BodyPublisher>();'
    )
    csharpBody.push('var form = new MultipartFormDataContent();', 'request.Content = form;')
    for (const [index, field] of fields.entries()) {
      if (field.file) {
        goBody.push(
          `file${index} := must(os.Open("/path/to/document.pdf"))`,
          `part${index} := must(writer.CreateFormFile(${quote(field.name)}, "document.pdf"))`,
          `must(io.Copy(part${index}, file${index}))`,
          `check(file${index}.Close())`
        )
        csharpBody.push(
          `form.Add(new StreamContent(File.OpenRead("/path/to/document.pdf")), ${quote(field.name)}, "document.pdf");`
        )
      } else {
        goBody.push(`check(writer.WriteField(${quote(field.name)}, ${quote(field.value)}))`)
        csharpBody.push(`form.Add(new StringContent(${quote(field.value)}), ${quote(field.name)});`)
      }
      const disposition = `\r\nContent-Disposition: form-data; name="${field.name}"${field.file ? '; filename="document.pdf"\r\nContent-Type: application/octet-stream' : ''}\r\n\r\n`
      javaBody.push(
        `parts.add(HttpRequest.BodyPublishers.ofString("--" + boundary + ${quote(disposition)}));`,
        field.file
          ? 'parts.add(HttpRequest.BodyPublishers.ofFile(java.nio.file.Path.of("/path/to/document.pdf")));'
          : `parts.add(HttpRequest.BodyPublishers.ofString(${quote(field.value)}));`,
        'parts.add(HttpRequest.BodyPublishers.ofString("\\r\\n"));'
      )
    }
    goBody.push('check(writer.Close())')
    goPayload = 'payload'
    javaBody.push(
      'parts.add(HttpRequest.BodyPublishers.ofString("--" + boundary + "--\\r\\n"));',
      'var payload = HttpRequest.BodyPublishers.concat(parts.toArray(HttpRequest.BodyPublisher[]::new));',
      'builder.header("Content-Type", "multipart/form-data; boundary=" + boundary);'
    )
    javaPayload = 'payload'
  } else if (body !== undefined) {
    goImports.push('strings')
    goPayload = `strings.NewReader(${quote(body)})`
    javaPayload = `HttpRequest.BodyPublishers.ofString(${quote(body)})`
    csharpBody.push(`request.Content = new StringContent(${quote(body)}, Encoding.UTF8);`)
  }
  const goHeaders = Object.entries(headers).map(
    ([name, value]) => `request.Header.Set(${quote(name)}, ${quote(value)})`
  )
  if (fields) goHeaders.push('request.Header.Set("Content-Type", writer.FormDataContentType())')
  const javaHeaders = Object.entries(headers).map(
    ([name, value]) => `builder.header(${quote(name)}, ${quote(value)});`
  )
  const csharpHeaders = Object.entries(headers).map(([name, value]) =>
    name.toLowerCase() === 'content-type'
      ? `request.Content!.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(${quote(value)});`
      : `request.Headers.TryAddWithoutValidation(${quote(name)}, ${quote(value)});`
  )
  return [
    {
      label: 'Go',
      language: 'go',
      code: `package main

import (
${goImports.map((name) => `  ${quote(name)}`).join('\n')}
)

func check(err error) {
  if err != nil { panic(err) }
}

func must[T any](value T, err error) T {
  check(err)
  return value
}

func main() {
${goBody.map((line) => `  ${line}`).join('\n')}
  request := must(http.NewRequest(${quote(method)}, ${quote(url)}, ${goPayload}))
${goHeaders.map((line) => `  ${line}`).join('\n')}
  response := must(http.DefaultClient.Do(request))
  defer response.Body.Close()
  if response.StatusCode >= 400 { panic(response.Status) }
  must(io.Copy(os.Stdout, response.Body))
}`,
    },
    {
      label: 'Java',
      language: 'java',
      code: `import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Example {
  public static void main(String[] args) throws Exception {
    var builder = HttpRequest.newBuilder(URI.create(${quote(url)}));
${[...javaHeaders, ...javaBody].map((line) => `    ${line}`).join('\n')}
    var request = builder.method(${quote(method)}, ${javaPayload}).build();
    var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofInputStream());
    try (var body = response.body()) {
      if (response.statusCode() >= 400) throw new IllegalStateException("HTTP " + response.statusCode());
      body.transferTo(System.out);
    }
  }
}`,
    },
    {
      label: 'C#',
      language: 'csharp',
      code: `using System;
using System.IO;
using System.Net.Http;
using System.Text;

using var client = new HttpClient();
using var request = new HttpRequestMessage(new HttpMethod(${quote(method)}), ${quote(url)});
${[...csharpBody, ...csharpHeaders].join('\n')}
using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
response.EnsureSuccessStatusCode();
await response.Content.CopyToAsync(Console.OpenStandardOutput());`,
    },
  ]
}

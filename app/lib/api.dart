import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.status});
  final String message;
  final int? status;
  bool get unauthorized => status == 401;
  @override
  String toString() => message;
}

/// Talks to the BagSpec Worker with the same owner login as the dashboard
/// (HTTP Basic, username "bagspec").
class BagSpecApi {
  BagSpecApi({
    required this.password,
    http.Client? client,
    String? baseUrl,
  })  : baseUrl = baseUrl ?? _defaultBaseUrl(),
        _client = client ?? http.Client();

  /// The iPhone app talks to bagspec.com. The browser preview is built with
  /// `--dart-define=BAGSPEC_API=` (empty) and calls the page's own origin,
  /// where tool/preview.mjs forwards requests to the Worker.
  static String _defaultBaseUrl() {
    const configured = String.fromEnvironment('BAGSPEC_API', defaultValue: 'https://bagspec.com');
    return configured.isEmpty ? Uri.base.origin : configured;
  }

  final String password;
  final String baseUrl;
  final http.Client _client;

  Map<String, String> get _headers => {
        'Authorization': 'Basic ${base64Encode(utf8.encode('bagspec:$password'))}',
        'Content-Type': 'application/json',
        'X-BagSpec-Quiet': '1',
      };

  Future<dynamic> _send(String method, String path, [Object? body]) async {
    final uri = Uri.parse('$baseUrl$path');
    final request = http.Request(method, uri)..headers.addAll(_headers);
    if (body != null) request.body = jsonEncode(body);
    final http.Response response;
    try {
      response = await http.Response.fromStream(
          await _client.send(request).timeout(const Duration(seconds: 20)));
    } catch (_) {
      throw ApiException('Could not reach BagSpec. Check your connection.');
    }
    if (response.statusCode == 401) {
      throw ApiException('Wrong password.', status: 401);
    }
    final decoded = response.body.isEmpty ? null : jsonDecode(response.body);
    if (response.statusCode >= 400) {
      final error = decoded is Map ? decoded['error'] : null;
      throw ApiException(error?.toString() ?? 'BagSpec returned ${response.statusCode}.',
          status: response.statusCode);
    }
    return decoded;
  }

  /// Throws [ApiException] with `unauthorized` when the password is wrong.
  Future<void> checkLogin() async => _send('GET', '/api/inventory');

  Future<DealsPage> deals({int? before}) async {
    final json = await _send('GET', before == null ? '/deals' : '/deals?before=$before');
    return DealsPage.fromJson(json as Map<String, dynamic>);
  }

  Future<Inventory> inventory() async =>
      Inventory.fromJson(await _send('GET', '/api/inventory') as Map<String, dynamic>);

  // ---- My flips --------------------------------------------------------

  /// "I bought this" on a deal, or a manual item when [listingId] is null.
  /// Leave [salesTax] null to let BagSpec estimate 6%.
  Future<void> addFlip({
    int? listingId,
    String? itemName,
    required double purchasePrice,
    double? inboundShipping,
    double? salesTax,
    double? partsCost,
    String? notes,
  }) =>
      _send('POST', '/api/inventory', {
        'listingId': ?listingId,
        'itemName': ?itemName,
        'purchasePrice': purchasePrice,
        'inboundShipping': ?inboundShipping,
        'salesTax': ?salesTax,
        'partsCost': ?partsCost,
        'notes': ?notes,
      });

  /// Sends only the fields that changed, as the website does.
  Future<void> updateFlip(int id, Map<String, Object> changes) => _send('POST', '/api/inventory/$id', changes);

  Future<void> markFlipSold(int id, {required double salePrice, required String channel, double? outboundShipping}) =>
      _send('POST', '/api/inventory/$id', {
        'status': 'sold',
        'salePrice': salePrice,
        'saleChannel': channel,
        'outboundShipping': ?outboundShipping,
      });

  Future<void> deleteFlip(int id) => _send('POST', '/api/inventory/$id/delete', const {});

  // ---- Connected eBay account -----------------------------------------

  Future<EbayStatus> ebayStatus() async =>
      EbayStatus.fromJson(await _send('GET', '/api/ebay/status') as Map<String, dynamic>);

  /// eBay's sign-in page, to open in Safari.
  Future<Uri> ebayConnectUrl() async {
    final json = await _send('POST', '/api/ebay/connect', const {}) as Map<String, dynamic>;
    return Uri.parse(json['url'] as String);
  }

  Future<void> ebaySyncNow() => _send('POST', '/api/ebay/sync', const {});

  Future<void> ebayAddPurchase(String orderLineId) =>
      _send('POST', '/api/ebay/purchases/${Uri.encodeComponent(orderLineId)}/add', const {});

  Future<void> ebayHidePurchase(String orderLineId) =>
      _send('POST', '/api/ebay/purchases/${Uri.encodeComponent(orderLineId)}/hide', const {});

  // ---- Push --------------------------------------------------------------

  Future<AlertSettings> registerDevice({
    required String token,
    required bool sandbox,
    required AlertSettings settings,
    String? deviceName,
  }) async {
    final json = await _send('POST', '/api/devices', {
      'token': token,
      'environment': sandbox ? 'sandbox' : 'production',
      'settings': settings.toJson(),
      'deviceName': ?deviceName,
    }) as Map<String, dynamic>;
    return AlertSettings.fromJson(json['settings'] as Map<String, dynamic>? ?? const {});
  }

  Future<void> unregisterDevice(String token) =>
      _send('DELETE', '/api/devices/${Uri.encodeComponent(token)}');

  Future<void> sendTestNotification(String token) =>
      _send('POST', '/api/devices/test', {'token': token});
}

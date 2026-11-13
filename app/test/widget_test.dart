import 'dart:convert';

import 'package:bagspec/api.dart';
import 'package:bagspec/main.dart';
import 'package:bagspec/models.dart';
import 'package:bagspec/screens/deal_detail_screen.dart';
import 'package:bagspec/screens/deals_screen.dart';
import 'package:bagspec/screens/flips_screen.dart';
import 'package:bagspec/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

final dealJson = {
  'id': 1604529,
  'title': 'Olympus Camedia C-740 Ultra Zoom Digital Camera',
  'item_url': 'https://www.ebay.com/itm/128175992473',
  'image_url': 'https://i.ebayimg.com/images/g/x/s-l225.jpg',
  'category': 'Cameras',
  'price': 3,
  'shipping_cost': 8.53,
  'estimated_tax': 0.69,
  'total_buy_cost': 12.22,
  'estimated_profit': 17.89,
  'suggested_offer': 9.5,
  'recommendation': 'BUY',
  'deal_type': 'auction',
  'item_end_date': '2026-11-11T03:21:00.000Z',
  'inventory_id': 1,
  'first_seen_at': '2026-11-12 01:20:54',
  'reasoning': jsonEncode({'explanation': 'Lens error is usually a stuck barrel.', 'redFlags': ['No photo of the screen']}),
};

final flipJson = {
  'id': 1,
  'listing_id': 1604529,
  'item_name': 'Olympus Camedia C-740 Ultra Zoom Digital Camera',
  'purchase_price': 3,
  'inbound_shipping': 8.53,
  'sales_tax': 0.69,
  'parts_cost': 0,
  'status': 'purchased',
  'item_url': 'https://www.ebay.com/itm/128175992473?hash=item1dd7',
  'image_url': 'https://i.ebayimg.com/images/g/x/s-l225.jpg',
  'estimated_profit': 17.89,
  'cost': 12.22,
  'profit': null,
};

final ebayStatusJson = {
  'connected': true,
  'configured': true,
  'needsReconnect': false,
  'lastSyncAt': '2026-11-13T03:25:00.000Z',
  'lastSyncError': null,
  'otherPurchases': [
    {'order_line_id': '555-9', 'item_id': '555', 'title': 'ThinkPad T480 for parts', 'price': 42.5, 'shipping': 12.99,
     'order_url': 'https://order.ebay.com/ord/show?itemid=555&transid=9'},
  ],
  'orderLinks': {'1': 'https://order.ebay.com/ord/show?itemid=128175992473&transid=10085495116123'},
};

/// A fake BagSpec server: the password "right" works, anything else is 401.
MockClient fakeServer({List<http.Request>? log}) => MockClient((request) async {
      log?.add(request);
      final auth = request.headers['Authorization'];
      final ok = auth == 'Basic ${base64Encode(utf8.encode('bagspec:right'))}';
      if (!ok) return http.Response('BagSpec login required', 401);
      switch (request.url.path) {
        case '/deals':
          return http.Response(jsonEncode({'count': 1, 'nextBefore': null, 'deals': [dealJson]}), 200);
        case '/api/inventory':
          if (request.method == 'POST') return http.Response('{"ok":true,"id":2}', 201);
          return http.Response(jsonEncode({'items': [flipJson], 'summary': {'totalProfit': 0, 'moneyTiedUp': 12.22, 'open': 1}}), 200);
        case '/api/inventory/1':
          return http.Response('{"ok":true}', 200);
        case '/api/ebay/status':
          return http.Response(jsonEncode(ebayStatusJson), 200);
        case '/api/ebay/connect':
          return http.Response('{"url":"https://auth.ebay.com/oauth2/authorize?state=x"}', 200);
        case '/api/devices':
          return http.Response(jsonEncode({'ok': true, 'settings': jsonDecode(request.body)['settings']}), 201);
      }
      return http.Response('{"error":"Not found"}', 404);
    });

void main() {
  FlutterSecureStorage.setMockInitialValues({});

  test('deals parse the owner notes and auction fields', () {
    final deal = Deal.fromJson(dealJson);
    expect(deal.isBuy, isTrue);
    expect(deal.isAuction, isTrue);
    expect(deal.ended, isTrue);
    expect(deal.bought, isTrue);
    expect(deal.explanation, 'Lens error is usually a stuck barrel.');
    expect(deal.redFlags, ['No photo of the screen']);
    expect(deal.firstSeenAt, DateTime.utc(2026, 11, 12, 1, 20, 54).toLocal());
    expect(money(-3.5), '-\$3.50');
  });

  test('the API sends the owner login and registers the device token', () async {
    final log = <http.Request>[];
    final api = BagSpecApi(password: 'right', client: fakeServer(log: log));
    final page = await api.deals();
    expect(page.deals.single.title, startsWith('Olympus'));
    final settings = await api.registerDevice(
        token: 'ab' * 32, sandbox: false, settings: const AlertSettings(digest: true));
    expect(settings.digest, isTrue);
    final body = jsonDecode(log.last.body) as Map<String, dynamic>;
    expect(body['environment'], 'production');
    expect(body['token'], 'ab' * 32);
  });

  test('a wrong password is reported as unauthorized', () async {
    final api = BagSpecApi(password: 'wrong', client: fakeServer());
    expect(() => api.checkLogin(), throwsA(isA<ApiException>().having((e) => e.unauthorized, 'unauthorized', isTrue)));
  });

  testWidgets('signing in with the wrong password shows an error, the right one opens Deals', (tester) async {
    await tester.pumpWidget(BagSpecApp(apiFactory: (password) => BagSpecApi(password: password, client: fakeServer())));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('password')), 'wrong');
    await tester.tap(find.byKey(const Key('sign-in')));
    await tester.pumpAndSettle();
    expect(find.text('Wrong password.'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('password')), 'right');
    await tester.tap(find.byKey(const Key('sign-in')));
    await tester.pumpAndSettle();
    expect(find.text('Deals'), findsWidgets);
    expect(find.textContaining('Olympus Camedia'), findsOneWidget);
    expect(find.text('\$17.89'), findsOneWidget);
  });

  testWidgets('deal detail shows the bid limit, notes and an eBay button', (tester) async {
    await tester.pumpWidget(MaterialApp(theme: bagSpecTheme(), home: DealDetailScreen(deal: Deal.fromJson(dealJson))));
    expect(find.text('Bid up to'), findsOneWidget);
    expect(find.text('\$9.50'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Lens error is usually a stuck barrel.'), 200);
    expect(find.text('• No photo of the screen'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Open on eBay'), 200);
    expect(find.text('Open on eBay'), findsOneWidget);
  });

  testWidgets('deal cards show WATCH vs BUY tags', (tester) async {
    final watch = Deal.fromJson({...dealJson, 'recommendation': 'WATCH', 'deal_type': 'repair', 'inventory_id': null});
    await tester.pumpWidget(MaterialApp(theme: bagSpecTheme(), home: Scaffold(body: DealCard(deal: watch))));
    expect(find.text('WATCH'), findsOneWidget);
    expect(find.text('Bought'), findsNothing);
    expect(find.text('Cameras · \$12.22 all-in'), findsOneWidget);
  });

  test('eBay status maps My flips items to their order pages', () {
    final status = EbayStatus.fromJson(ebayStatusJson);
    expect(status.orderLinks[1], startsWith('https://order.ebay.com/ord/show'));
    expect(status.otherPurchases.single.orderUrl, contains('transid=9'));
  });

  testWidgets('My flips shows the eBay connection, other purchases, and the order link', (tester) async {
    final api = BagSpecApi(password: 'right', client: fakeServer());
    await tester.pumpWidget(MaterialApp(theme: bagSpecTheme(), home: FlipsScreen(api: api)));
    await tester.pumpAndSettle();
    expect(find.text('eBay connected'), findsOneWidget);
    expect(find.text('Check now'), findsOneWidget);
    expect(find.text('Other eBay purchases'), findsOneWidget);
    expect(find.text('ThinkPad T480 for parts'), findsOneWidget);
    expect(find.text('Add'), findsOneWidget);
    expect(find.text('Hide'), findsOneWidget);

    await tester.tap(find.text('Olympus Camedia C-740 Ultra Zoom Digital Camera'));
    await tester.pumpAndSettle();
    expect(find.text('View eBay order'), findsOneWidget, reason: 'purchases open the order, not the ended listing');
    expect(find.text('View original listing'), findsOneWidget);
    expect(find.text('Mark sold'), findsOneWidget);
  });

  testWidgets('Mark sold sends the price and where it sold', (tester) async {
    final log = <http.Request>[];
    final api = BagSpecApi(password: 'right', client: fakeServer(log: log));
    await tester.pumpWidget(MaterialApp(theme: bagSpecTheme(), home: FlipsScreen(api: api)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Olympus Camedia C-740 Ultra Zoom Digital Camera'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mark sold'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('field-salePrice')), '45');
    await tester.tap(find.byKey(const Key('form-submit')));
    await tester.pumpAndSettle();
    final sold = log.firstWhere((r) => r.method == 'POST' && r.url.path == '/api/inventory/1');
    expect(jsonDecode(sold.body), {'status': 'sold', 'salePrice': 45.0, 'saleChannel': 'eBay'});
  });

  testWidgets('"I bought this" on a deal saves it to My flips', (tester) async {
    final log = <http.Request>[];
    final api = BagSpecApi(password: 'right', client: fakeServer(log: log));
    final deal = Deal.fromJson({...dealJson, 'inventory_id': null, 'deal_type': 'repair'});
    await tester.pumpWidget(MaterialApp(theme: bagSpecTheme(), home: DealDetailScreen(deal: deal, api: api)));
    await tester.scrollUntilVisible(find.byKey(const Key('bought-this')), 200);
    await tester.tap(find.byKey(const Key('bought-this')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('form-submit')));
    await tester.pumpAndSettle();
    final saved = jsonDecode(log.lastWhere((r) => r.method == 'POST').body) as Map<String, dynamic>;
    expect(saved['listingId'], 1604529);
    expect(saved['purchasePrice'], 3.0, reason: 'prefilled with the listing price');
    expect(saved['inboundShipping'], 8.53);
  });
}

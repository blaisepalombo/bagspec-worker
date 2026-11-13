import 'dart:convert';

double? _num(Object? value) => value is num ? value.toDouble() : double.tryParse('${value ?? ''}');

/// D1 stores UTC times as "YYYY-MM-DD HH:MM:SS".
DateTime? parseServerTime(Object? value) {
  final text = value?.toString();
  if (text == null || text.isEmpty) return null;
  final iso = text.contains('T') ? text : '${text.replaceFirst(' ', 'T')}Z';
  return DateTime.tryParse(iso)?.toLocal();
}

class Deal {
  Deal({
    required this.id,
    required this.title,
    required this.recommendation,
    this.itemUrl,
    this.imageUrl,
    this.category,
    this.dealType,
    this.price,
    this.shipping,
    this.tax,
    this.totalBuyCost,
    this.estimatedProfit,
    this.roiPercent,
    this.suggestedOffer,
    this.likelyIssue,
    this.partsCost,
    this.resaleLocal,
    this.resaleEbay,
    this.repairRisk,
    this.endsAt,
    this.firstSeenAt,
    this.explanation,
    this.redFlags = const [],
    this.bought = false,
  });

  final int id;
  final String title;
  final String recommendation;
  final String? itemUrl;
  final String? imageUrl;
  final String? category;
  final String? dealType;
  final double? price;
  final double? shipping;
  final double? tax;
  final double? totalBuyCost;
  final double? estimatedProfit;
  final double? roiPercent;
  final double? suggestedOffer;
  final String? likelyIssue;
  final double? partsCost;
  final double? resaleLocal;
  final double? resaleEbay;
  final double? repairRisk;
  final DateTime? endsAt;
  final DateTime? firstSeenAt;
  final String? explanation;
  final List<String> redFlags;
  final bool bought;

  bool get isAuction => dealType == 'auction';
  bool get isBuy => recommendation == 'BUY';
  bool get ended => endsAt != null && endsAt!.isBefore(DateTime.now());

  factory Deal.fromJson(Map<String, dynamic> json) {
    // The owner view includes the analysis notes as a JSON string.
    Map<String, dynamic> notes = const {};
    final reasoning = json['reasoning'];
    if (reasoning is String && reasoning.trim().startsWith('{')) {
      try {
        notes = jsonDecode(reasoning) as Map<String, dynamic>;
      } catch (_) {}
    }
    return Deal(
      id: (json['id'] as num).toInt(),
      title: (json['title'] ?? 'Untitled listing').toString(),
      recommendation: (json['recommendation'] ?? 'WATCH').toString(),
      itemUrl: json['item_url'] as String?,
      imageUrl: json['image_url'] as String?,
      category: json['category'] as String?,
      dealType: json['deal_type'] as String?,
      price: _num(json['price']),
      shipping: _num(json['shipping_cost']),
      tax: _num(json['estimated_tax']),
      totalBuyCost: _num(json['total_buy_cost']),
      estimatedProfit: _num(json['estimated_profit']),
      roiPercent: _num(json['roi_percent']),
      suggestedOffer: _num(json['suggested_offer']),
      likelyIssue: json['likely_issue'] as String?,
      partsCost: _num(json['estimated_parts_cost']),
      resaleLocal: _num(json['estimated_resale_local']),
      resaleEbay: _num(json['estimated_resale_ebay']),
      repairRisk: _num(json['repair_risk']),
      endsAt: parseServerTime(json['item_end_date']),
      firstSeenAt: parseServerTime(json['first_seen_at']),
      explanation: notes['explanation'] as String?,
      redFlags: (notes['redFlags'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      bought: json['inventory_id'] != null,
    );
  }
}

class DealsPage {
  DealsPage({required this.deals, this.nextBefore, this.stale = false});
  final List<Deal> deals;
  final int? nextBefore;
  final bool stale;

  factory DealsPage.fromJson(Map<String, dynamic> json) => DealsPage(
        deals: ((json['deals'] as List?) ?? const [])
            .map((e) => Deal.fromJson(e as Map<String, dynamic>))
            .toList(),
        nextBefore: (json['nextBefore'] as num?)?.toInt(),
        stale: json['stale'] == true,
      );
}

class Flip {
  Flip({
    required this.id,
    required this.name,
    required this.status,
    this.cost,
    this.profit,
    this.salePrice,
    this.saleChannel,
    this.purchasedAt,
    this.itemUrl,
    this.imageUrl,
    this.estimatedProfit,
    this.notes,
  });

  final int id;
  final String name;
  final String status;
  final double? cost;
  final double? profit;
  final double? salePrice;
  final String? saleChannel;
  final DateTime? purchasedAt;
  final String? itemUrl;
  final String? imageUrl;
  final double? estimatedProfit;
  final String? notes;

  bool get sold => status == 'sold';

  String get statusLabel => const {
        'purchased': 'Bought',
        'repairing': 'Repairing',
        'listed': 'Listed for sale',
        'sold': 'Sold',
        'failed': 'Could not fix',
      }[status] ??
      status;

  factory Flip.fromJson(Map<String, dynamic> json) => Flip(
        id: (json['id'] as num).toInt(),
        name: (json['item_name'] ?? 'Item').toString(),
        status: (json['status'] ?? 'purchased').toString(),
        cost: _num(json['cost']),
        profit: _num(json['profit']),
        salePrice: _num(json['sale_price']),
        saleChannel: json['sale_channel'] as String?,
        purchasedAt: parseServerTime(json['purchased_at']),
        itemUrl: json['item_url'] as String?,
        imageUrl: json['image_url'] as String?,
        estimatedProfit: _num(json['estimated_profit']),
        notes: json['notes'] as String?,
      );
}

class Inventory {
  Inventory({required this.items, required this.totalProfit, required this.moneyTiedUp, required this.open, required this.sold});
  final List<Flip> items;
  final double totalProfit;
  final double moneyTiedUp;
  final int open;
  final int sold;

  factory Inventory.fromJson(Map<String, dynamic> json) {
    final summary = (json['summary'] as Map<String, dynamic>?) ?? const {};
    return Inventory(
      items: ((json['items'] as List?) ?? const []).map((e) => Flip.fromJson(e as Map<String, dynamic>)).toList(),
      totalProfit: _num(summary['totalProfit']) ?? 0,
      moneyTiedUp: _num(summary['moneyTiedUp']) ?? 0,
      open: (summary['open'] as num?)?.toInt() ?? 0,
      sold: (summary['sold'] as num?)?.toInt() ?? 0,
    );
  }
}

class AlertSettings {
  const AlertSettings({this.buy = true, this.auctions = true, this.digest = false});
  final bool buy;
  final bool auctions;
  final bool digest;

  AlertSettings copyWith({bool? buy, bool? auctions, bool? digest}) =>
      AlertSettings(buy: buy ?? this.buy, auctions: auctions ?? this.auctions, digest: digest ?? this.digest);

  Map<String, dynamic> toJson() => {'buy': buy, 'auctions': auctions, 'digest': digest};

  factory AlertSettings.fromJson(Map<String, dynamic> json) => AlertSettings(
        buy: json['buy'] != false,
        auctions: json['auctions'] != false,
        digest: json['digest'] == true,
      );
}

String money(double? value) {
  if (value == null) return '—';
  final sign = value < 0 ? '-' : '';
  return '$sign\$${value.abs().toStringAsFixed(2)}';
}

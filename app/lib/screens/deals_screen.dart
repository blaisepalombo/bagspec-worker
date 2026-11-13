import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import 'deal_detail_screen.dart';

class DealsScreen extends StatefulWidget {
  const DealsScreen({super.key, required this.api});
  final BagSpecApi api;

  @override
  State<DealsScreen> createState() => _DealsScreenState();
}

class _DealsScreenState extends State<DealsScreen> {
  final List<Deal> _deals = [];
  int? _nextBefore;
  bool _loading = true;
  bool _loadingOlder = false;
  bool _stale = false;
  bool _buyOnly = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = _deals.isEmpty;
      _error = null;
    });
    try {
      final page = await widget.api.deals();
      setState(() {
        _deals
          ..clear()
          ..addAll(page.deals);
        _nextBefore = page.nextBefore;
        _stale = page.stale;
      });
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadOlder() async {
    if (_nextBefore == null || _loadingOlder) return;
    setState(() => _loadingOlder = true);
    try {
      final page = await widget.api.deals(before: _nextBefore);
      setState(() {
        _deals.addAll(page.deals);
        _nextBefore = page.nextBefore;
      });
    } on ApiException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final shown = _buyOnly ? _deals.where((d) => d.isBuy).toList() : _deals;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Deals'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: FilterChip(
              label: const Text('BUY only'),
              selected: _buyOnly,
              onSelected: (value) => setState(() => _buyOnly = value),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null && _deals.isEmpty
                ? _Message(title: 'Could not load deals', body: _error!)
                : shown.isEmpty
                    ? const _Message(title: 'No deals yet', body: 'BagSpec scans eBay every 5 minutes. New BUY deals send a notification.')
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                        itemCount: shown.length + 1 + (_stale ? 1 : 0),
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (context, index) {
                          if (_stale && index == 0) {
                            return const Text('Database busy · showing the last saved deals',
                                style: TextStyle(color: BagSpecColors.amber));
                          }
                          final i = index - (_stale ? 1 : 0);
                          if (i == shown.length) {
                            return _nextBefore == null
                                ? const SizedBox.shrink()
                                : OutlinedButton(
                                    onPressed: _loadingOlder ? null : _loadOlder,
                                    child: Text(_loadingOlder ? 'Loading…' : 'Load older deals'),
                                  );
                          }
                          return DealCard(deal: shown[i]);
                        },
                      ),
      ),
    );
  }
}

class DealCard extends StatelessWidget {
  const DealCard({super.key, required this.deal});
  final Deal deal;

  @override
  Widget build(BuildContext context) {
    final profitColor = (deal.estimatedProfit ?? 0) >= 0 ? BagSpecColors.green : BagSpecColors.red;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => DealDetailScreen(deal: deal))),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DealImage(url: deal.imageUrl, size: 72),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(spacing: 6, runSpacing: 4, children: [
                      Tag(deal.recommendation, color: deal.isBuy ? BagSpecColors.green : BagSpecColors.amber),
                      if (deal.isAuction) Tag(deal.ended ? 'Auction ended' : 'Auction', color: BagSpecColors.muted),
                      if (deal.bought) const Tag('Bought', color: BagSpecColors.green),
                    ]),
                    const SizedBox(height: 6),
                    Text(deal.title, maxLines: 2, overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    Text(
                      [
                        if (deal.category != null) deal.category!,
                        deal.isAuction && deal.suggestedOffer != null
                            ? 'bid up to ${money(deal.suggestedOffer)}'
                            : '${money(deal.totalBuyCost)} all-in',
                      ].join(' · '),
                      style: const TextStyle(color: BagSpecColors.muted, fontSize: 13),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text(money(deal.estimatedProfit), style: TextStyle(color: profitColor, fontWeight: FontWeight.w700, fontSize: 16)),
                const Text('profit', style: TextStyle(color: BagSpecColors.muted, fontSize: 12)),
              ]),
            ],
          ),
        ),
      ),
    );
  }
}

class Tag extends StatelessWidget {
  const Tag(this.label, {super.key, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          border: Border.all(color: color.withValues(alpha: 0.6)),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600)),
      );
}

class DealImage extends StatelessWidget {
  const DealImage({super.key, required this.url, required this.size});
  final String? url;
  final double size;

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      width: size,
      height: size,
      color: BagSpecColors.line,
      child: const Icon(Icons.image_not_supported_outlined, color: BagSpecColors.muted),
    );
    // Only eBay's image host, like the website.
    final safe = url != null && url!.startsWith('https://i.ebayimg.com/');
    return ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: safe
          ? Image.network(url!, width: size, height: size, fit: BoxFit.cover,
              // In the browser preview eBay's images lack CORS headers, so
              // fall back to a plain <img>. No effect on iPhone.
              webHtmlElementStrategy: WebHtmlElementStrategy.fallback,
              errorBuilder: (_, _, _) => placeholder)
          : placeholder,
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.title, required this.body});
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(32),
        children: [
          const SizedBox(height: 80),
          Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(body, textAlign: TextAlign.center, style: const TextStyle(color: BagSpecColors.muted)),
        ],
      );
}

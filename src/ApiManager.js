class ApiManager {
  constructor() {
    this.baseUrl = 'https://apicdn.mixlr.com/v3/channel_view/';
  }

  async getStreamInfo(channelId) {
    const url = `${this.baseUrl}${channelId}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return {
          live: false,
          error: `API request failed with status ${response.status}`,
          name: channelId,
          channelId: channelId,
        };
      }
      const data = await response.json();

      const isLive = data?.data?.attributes?.live || false;
      const username = data?.data?.attributes?.username || channelId;

      if (isLive) {
        // Find the current broadcast in the included array
        const broadcast = data.included?.find(
          (item) => item.type === 'broadcast' && item.attributes?.live === true
        );
        
        const streamUrl = broadcast?.attributes?.progressive_stream_url;
        // Get listener_count from the broadcast object, not from data.attributes
        const listenerCount = broadcast?.attributes?.listener_count || 0;

        if (streamUrl) {
          return {
            live: true,
            url: streamUrl,
            name: username,
            channelId: channelId,
            listenerCount: listenerCount
          };
        }
      }

      return {
        live: false,
        name: username,
        channelId: channelId,
      };
    } catch (error) {
      return {
        live: false,
        error: error.message,
        name: channelId,
        channelId: channelId,
      };
    }
  }
}

module.exports = ApiManager;

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 * Taedal v7 ERC-721 (matches your app-side ABI)
 * - publicMint(string uri)
 * - safeMint(address to, string uri)
 * Uses OZ ERC721URIStorage for per-token tokenURI (e.g., ipfs://...).
 */

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol"; // <-- add this
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

abstract contract Counter {
    uint256 internal _counter;
    function _nextId() internal returns (uint256 id) { unchecked { id = ++_counter; } }
    function currentId() public view returns (uint256) { return _counter; }
}

contract TaedalNFT is ERC721URIStorage, Ownable, Counter {
    constructor() ERC721("Taedal", "TAEDAL") Ownable(msg.sender) {}

    /// @notice owner-only (kept to satisfy your UI’s safeMint detection)
    function safeMint(address to, string memory uri) external onlyOwner {
        uint256 tokenId = _nextId();
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    /// @notice open mint; the UI passes a full ipfs:// tokenURI
    function publicMint(string memory uri) external {
        uint256 tokenId = _nextId();
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
    }
}
